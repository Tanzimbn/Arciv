import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import get_current_user
from api.models.link import Link
from api.models.user import User
from api.schemas.link import LinkCreate, LinkResponse, LinkUpdate
from api.utils.heuristics import classify_by_url
from api.utils.metadata import canonicalize_url, fetch_metadata

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
        fetch_status=meta["fetch_status"],
        content_type=content_type,
        queue=queue,
        ai_status="pending",
    )
    db.add(link)
    await db.commit()
    await db.refresh(link)

    arq_pool = getattr(request.app.state, "arq_pool", None)
    if arq_pool is not None:
        await arq_pool.enqueue_job("classify_link", str(link.id))

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
