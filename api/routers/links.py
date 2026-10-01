import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import StringConstraints
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import get_current_user
from api.models.link import Link
from api.models.user import User
from api.schemas.link import LinkCreate, LinkResponse, LinkUpdate
from agent.prompt import (
    INSIGHTS_SYSTEM,
    ParseError,
    build_insights_message,
    parse_insights_response,
)
from agent.embedding import embed_text
from agent.registry import make_provider
from api.config import settings
from api.utils.encryption import decrypt_secret
from api.utils.heuristics import classify_by_url
from api.utils.link_query import apply_link_filters, apply_queue_scope
from api.utils.metadata import canonicalize_url, fetch_article_text, fetch_metadata
from api.utils.ratelimit import enforce_user_rate_limit
from api.utils.storage import adjust_user_storage, link_bytes

router = APIRouter()

#: Topic keys to filter by, repeatable (``?tag=rust&tag=llm``). Each key becomes
#: its own EXISTS over the row's unnested ai_tags, so the count is capped: ten is
#: far more than a chip UI produces, and keeps a hand-built URL from turning into
#: ten normalising subqueries per row. The inner cap is per key, as before.
TagFilter = Annotated[
    list[Annotated[str, StringConstraints(max_length=50)]] | None,
    Query(
        max_length=10,
        description="Normalised topic key from GET /api/topics. Repeatable: ?tag=rust&tag=llm",
    ),
]


@router.post("", response_model=LinkResponse, status_code=status.HTTP_201_CREATED)
async def create_link(
    body: LinkCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Creates a new Link for the current user after validating URL and metadata.
    - Executes in `api/routers/links.py` as a POST route.
    - Canonicalizes URL, checks for existing user-specific link, fetches metadata.
    - Enqueues AI classification job when available; returns created Link
    """
    # Every guard that doesn't need the canonical URL runs before the first
    # outbound fetch. canonicalize_url is itself a request to a user-supplied
    # host, so limiting after it would leave the fetchers unthrottled — the
    # expensive half of the endpoint would be free.
    arq_pool = getattr(request.app.state, "arq_pool", None)
    await enforce_user_rate_limit(
        arq_pool,
        scope="links",
        user_id=current_user.id,
        limit=settings.LINKS_CREATE_PER_MINUTE,
        window=60,
        detail=f"Too fast — max {settings.LINKS_CREATE_PER_MINUTE} links per minute. Try again in a moment.",
    )

    if settings.MAX_LINKS_PER_USER > 0:
        link_count = await db.scalar(
            select(func.count()).select_from(Link).where(Link.user_id == current_user.id)
        )
        if link_count >= settings.MAX_LINKS_PER_USER:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Link limit reached ({settings.MAX_LINKS_PER_USER}). Delete some to add more.",
            )

    # Soft storage-bytes gate against the running total. AI content lands async
    # after create, so a user just under the cap may be nudged over by the
    # worker; the next create is then blocked. Fine for an abuse guard.
    if (
        settings.MAX_STORAGE_BYTES_PER_USER > 0
        and current_user.storage_bytes >= settings.MAX_STORAGE_BYTES_PER_USER
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Storage limit reached. Delete some links to free space.",
        )

    try:
        canonical = await canonicalize_url(body.url)
    except ValueError as exc:
        # Unsupported scheme, malformed URL, or a host that resolves into the
        # private network — a client error, not a server one.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc

    result = await db.execute(
        select(Link).where(
            Link.user_id == current_user.id,
            Link.canonical_url == canonical,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": f"You already saved this on {existing.saved_at.strftime('%Y-%m-%d')}. View it here.",
                "link_id": str(existing.id),
            },
        )

    meta = await fetch_metadata(canonical)
    content_type, queue = classify_by_url(canonical)

    if meta["fetch_status"] == "unreachable":
        queue = "inbox"
        content_type = None

    link = Link(
        user_id=current_user.id,
        url=body.url,
        canonical_url=canonical,
        title=meta["title"],
        description=meta["description"],
        favicon_url=meta["favicon_url"],
        published_date=meta.get("published_date"),
        fetch_status=meta["fetch_status"],
        content_type=content_type,
        queue=queue,
        ai_status="pending",
    )
    db.add(link)
    await db.commit()
    await db.refresh(link)

    await adjust_user_storage(db, current_user.id, link_bytes(link))
    await db.commit()

    if arq_pool is not None:
        if link.fetch_status == "unreachable":
            await arq_pool.enqueue_job(
                "retry_unreachable_fetch", str(link.id),
                _defer_by=timedelta(minutes=5),
            )
        else:
            await arq_pool.enqueue_job("classify_link", str(link.id))
        # Embed for semantic search — independent of AI classification, so links
        # are searchable even when no AI provider is configured.
        await arq_pool.enqueue_job("embed_link", str(link.id))

    return link


@router.get("", response_model=list[LinkResponse])
async def list_links(
    queue: str | None = Query(None),
    tag: TagFilter = None,
    tag_logic: Literal["any", "all"] = Query(
        "any", description="How several tags combine: union (any) or intersection (all)"
    ),
    content_type: str | None = Query(None, max_length=50),
    domain: str | None = Query(None, max_length=253, description="Exact host, e.g. github.com"),
    since: datetime | None = Query(None, description="Saved at or after this instant"),
    until: datetime | None = Query(None, description="Saved at or before this instant"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=1000),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Lists links for the current user, optionally filtered.
    - Executes in api/routers/links.py as a GET route.
    - Filters by queue if provided; defaults to active links.
    - ``tag``/``content_type``/``domain``/``since``/``until`` AND together on top,
      via the same helper the search route uses.

    The ``tag`` filter matches on the normalised key (api.utils.tags), so it scans
    the caller's rows rather than using an index: a GIN index on ``ai_tags`` indexes
    raw values and cannot answer a predicate over a normalised element. Bounded by
    ``MAX_LINKS_PER_USER`` and already narrowed by ``idx_links_user_queue``, so this
    is a scan of one user's library, not the table. Revisit with an IMMUTABLE
    normalising function plus a GIN expression index if per-user libraries grow.
    """
    q = select(Link).where(Link.user_id == current_user.id)
    q = apply_queue_scope(q, queue)

    q, impossible = apply_link_filters(
        q,
        tag=tag,
        tag_logic=tag_logic,
        content_type=content_type,
        domain=domain,
        since=since,
        until=until,
    )
    if impossible:
        return []

    q = q.order_by(Link.saved_at.desc()).offset((page - 1) * limit).limit(limit)
    result = await db.execute(q)
    return result.scalars().all()


async def _cached_query_embedding(redis, q: str) -> list[float] | None:
    """Embed a search query, caching the vector in Redis so repeat/identical
    searches skip the CPU embed. The cache is a best-effort optimization, never a
    dependency: when it's disabled (TTL 0) or Redis is down, we just embed."""
    ttl = settings.SEARCH_EMBED_CACHE_TTL
    if redis is None or ttl <= 0:
        return await embed_text(q)
    key = f"embed:q:{hashlib.sha256(q.encode()).hexdigest()}"
    try:
        cached = await redis.get(key)
        if cached is not None:
            return json.loads(cached)
    except Exception:  # Redis hiccup → fall through and embed directly
        return await embed_text(q)
    vec = await embed_text(q)
    if vec is not None:
        try:
            await redis.set(key, json.dumps(vec), ex=ttl)
        except Exception:  # cache write is best-effort; don't fail the search
            pass
    return vec


@router.get("/search", response_model=list[LinkResponse])
async def search_links(
    request: Request,
    q: str = Query(..., min_length=1),
    tag: TagFilter = None,
    tag_logic: Literal["any", "all"] = Query("any"),
    content_type: str | None = Query(None, max_length=50),
    domain: str | None = Query(None, max_length=253),
    since: datetime | None = Query(None),
    until: datetime | None = Query(None),
    limit: int = Query(30, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Semantic search over the user's links via embedding similarity.

    Declared before the dynamic /{link_id} routes so "search" isn't captured as
    an id. User-scoped like every other query. 503 when embeddings are disabled
    so the frontend can fall back to client-side substring filtering.
    """
    if not settings.EMBEDDINGS_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Semantic search is disabled.",
        )
    # Rate-limit before embedding — each query runs a CPU embedding, so this
    # is the DoS-sensitive path. Reject over-limit callers before that work.
    await enforce_user_rate_limit(
        getattr(request.app.state, "arq_pool", None),
        scope="search",
        user_id=current_user.id,
        limit=settings.SEARCH_PER_MINUTE,
        window=60,
        detail=f"Search rate limit exceeded: {settings.SEARCH_PER_MINUTE} per minute.",
    )
    vec = await _cached_query_embedding(
        getattr(request.app.state, "arq_pool", None), q
    )
    if vec is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Semantic search is unavailable.",
        )

    stmt = select(Link).where(
        Link.user_id == current_user.id, Link.embedding.is_not(None)
    )
    # Filter *before* ranking. Ranking first and filtering the page afterwards
    # would turn "top 30 matches, of which 3 are tagged rust" into a 3-result
    # search and hide the rest of the library's rust links entirely.
    stmt, impossible = apply_link_filters(
        stmt,
        tag=tag,
        tag_logic=tag_logic,
        content_type=content_type,
        domain=domain,
        since=since,
        until=until,
    )
    if impossible:
        return []
    stmt = stmt.order_by(Link.embedding.cosine_distance(vec)).limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{link_id}/similar", response_model=list[LinkResponse])
async def similar_links(
    link_id: uuid.UUID,
    limit: int = Query(5, ge=1, le=20),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Top-N links semantically closest to this one, by embedding cosine distance.

    User-scoped. Returns [] (not an error) when embeddings are disabled or the
    source link has no embedding yet, so the drawer can simply hide the panel.
    No query embedding runs here — we reuse the source link's stored vector — so
    this is cheap and not rate-limited like /search.
    """
    result = await db.execute(
        select(Link).where(Link.id == link_id, Link.user_id == current_user.id)
    )
    link = result.scalar_one_or_none()
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")

    if not settings.EMBEDDINGS_ENABLED or link.embedding is None:
        return []

    stmt = (
        select(Link)
        .where(
            Link.user_id == current_user.id,
            Link.id != link_id,
            Link.status == "active",
            Link.embedding.is_not(None),
        )
        .order_by(Link.embedding.cosine_distance(link.embedding))
        .limit(limit)
    )
    result = await db.execute(stmt)
    return result.scalars().all()


@router.patch("/{link_id}", response_model=LinkResponse)
async def update_link(
    link_id: uuid.UUID,
    body: LinkUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Link).where(Link.id == link_id, Link.user_id == current_user.id)
    )
    link = result.scalar_one_or_none()
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")

    before = link_bytes(link)

    if body.queue is not None:
        link.queue = body.queue
    if body.content_type is not None:
        link.content_type = body.content_type
    if body.ai_tags is not None:
        link.ai_tags = body.ai_tags
    if body.status is not None:
        link.status = body.status
        if body.status == "done" and link.done_at is None:
            link.done_at = datetime.now(timezone.utc)
        elif body.status == "active":
            link.done_at = None
    if body.notes is not None:
        link.notes = body.notes if body.notes.strip() else None

    await adjust_user_storage(db, link.user_id, link_bytes(link) - before)
    await db.commit()
    await db.refresh(link)
    return link


@router.delete("/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_link(
    link_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Link).where(Link.id == link_id, Link.user_id == current_user.id)
    )
    link = result.scalar_one_or_none()
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")

    await adjust_user_storage(db, link.user_id, -link_bytes(link))
    await db.delete(link)
    await db.commit()


@router.post("/{link_id}/retry-ai", response_model=LinkResponse)
async def retry_ai(
    link_id: uuid.UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Link).where(Link.id == link_id, Link.user_id == current_user.id)
    )
    link = result.scalar_one_or_none()
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")

    link.ai_status = "pending"
    link.ai_attempt_count = 0
    link.ai_error = None
    # Must clear, or a user who fixed their model/key in Settings could never get
    # this link off the terminal state — the sweep skips ai_error_kind="config".
    link.ai_error_kind = None
    link.ai_next_retry_at = None
    await db.commit()
    await db.refresh(link)

    arq_pool = getattr(request.app.state, "arq_pool", None)
    if arq_pool is not None:
        await arq_pool.enqueue_job("classify_link", str(link.id))

    return link


@router.post("/{link_id}/insights", response_model=LinkResponse)
async def generate_insights(
    link_id: uuid.UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(
        getattr(request.app.state, "arq_pool", None),
        scope="insights",
        user_id=current_user.id,
        limit=settings.INSIGHTS_PER_MINUTE,
        window=60,
        detail=f"Too fast — max {settings.INSIGHTS_PER_MINUTE} insight requests per minute. Try again in a moment.",
    )

    result = await db.execute(
        select(Link).where(Link.id == link_id, Link.user_id == current_user.id)
    )
    link = result.scalar_one_or_none()
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")

    # Resolve AI provider — user key first, then shared Gemini
    provider = None
    if current_user.ai_api_key_enc:
        try:
            api_key = decrypt_secret(current_user.ai_api_key_enc)
            provider = make_provider(
                current_user.ai_provider, api_key, current_user.ai_model
            )
        except Exception:
            pass
    if provider is None and settings.SHARED_GEMINI_KEY:
        provider = make_provider("gemini", settings.SHARED_GEMINI_KEY)
    if provider is None:
        raise HTTPException(
            status_code=422,
            detail="No AI provider configured. Add an API key in Settings to use this feature.",
        )

    # Fetch full article body for richer insights (fallback to stored description)
    content = await fetch_article_text(link.canonical_url)
    if not content and link.description:
        content = link.description

    user_msg = build_insights_message(
        title=link.title or "",
        content=content,
        url=link.canonical_url,
    )

    try:
        raw = await provider.generate(INSIGHTS_SYSTEM, user_msg)
        insights = parse_insights_response(raw)
    except ParseError as e:
        raise HTTPException(status_code=502, detail=f"AI returned unexpected format: {e}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI provider error: {e}")

    if not insights:
        raise HTTPException(status_code=502, detail="AI returned no insights. Try again.")

    before = link_bytes(link)
    link.ai_insights = insights
    await adjust_user_storage(db, link.user_id, link_bytes(link) - before)
    await db.commit()
    await db.refresh(link)
    return link
