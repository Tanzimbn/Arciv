import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
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
from api.utils.metadata import canonicalize_url, fetch_article_text, fetch_metadata
from api.utils.ratelimit import enforce_user_rate_limit

router = APIRouter()


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
    canonical = await canonicalize_url(body.url)

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

    arq_pool = getattr(request.app.state, "arq_pool", None)
    await enforce_user_rate_limit(
        arq_pool,
        scope="links",
        user_id=current_user.id,
        limit=settings.LINKS_CREATE_PER_HOUR,
        window=3600,
        detail=f"Rate limit exceeded: {settings.LINKS_CREATE_PER_HOUR} links per hour.",
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
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=1000),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Lists links for the current user, optionally filtered by queue.
    - Executes in api/routers/links.py as a GET route.
    - Filters by queue if provided; defaults to active links.
    """
    q = select(Link).where(Link.user_id == current_user.id)

    if queue == "archive":
        q = q.where(Link.status == "done")
    elif queue:
        q = q.where(Link.queue == queue, Link.status == "active")
    else:
        q = q.where(Link.status == "active")

    q = q.order_by(Link.saved_at.desc()).offset((page - 1) * limit).limit(limit)
    result = await db.execute(q)
    return result.scalars().all()


@router.get("/search", response_model=list[LinkResponse])
async def search_links(
    request: Request,
    q: str = Query(..., min_length=1),
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
    vec = await embed_text(q)
    if vec is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Semantic search is unavailable.",
        )

    stmt = (
        select(Link)
        .where(Link.user_id == current_user.id, Link.embedding.is_not(None))
        .order_by(Link.embedding.cosine_distance(vec))
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
        limit=settings.INSIGHTS_PER_HOUR,
        window=3600,
        detail=f"Insights rate limit exceeded: {settings.INSIGHTS_PER_HOUR} per hour.",
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
            provider = make_provider(current_user.ai_provider, api_key)
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

    link.ai_insights = insights
    await db.commit()
    await db.refresh(link)
    return link
