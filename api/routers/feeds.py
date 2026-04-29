import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import get_current_user
from api.models.feed import Feed, FeedItem
from api.models.link import Link
from api.models.user import User
from api.schemas.feed import (
    FeedCreate,
    FeedDiscoverRequest,
    FeedDiscoverResponse,
    FeedResponse,
    FeedUpdate,
)
from api.utils.feed_discovery import discover_feed, entry_guid, parse_feed_content
from api.utils.heuristics import classify_by_url
from api.utils.metadata import canonicalize_url

import httpx

router = APIRouter()


@router.post("/discover", response_model=FeedDiscoverResponse)
async def discover(body: FeedDiscoverRequest):
    info = await discover_feed(body.url)
    if not info:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No feed found at this URL. Try pasting the direct RSS feed URL.",
        )
    return FeedDiscoverResponse(
        feed_url=info.feed_url,
        title=info.title,
        item_count=info.item_count,
        favicon_url=info.favicon_url,
    )


@router.post("/", response_model=FeedResponse, status_code=status.HTTP_201_CREATED)
async def subscribe(
    body: FeedCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Feed).where(Feed.user_id == current_user.id, Feed.feed_url == body.feed_url)
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already subscribed to this feed.")

    feed = Feed(
        user_id=current_user.id,
        site_url=body.site_url,
        feed_url=body.feed_url,
        title=body.title,
        favicon_url=body.favicon_url,
    )
    db.add(feed)
    await db.flush()  # get feed.id before commit

    # Import 10 most recent items
    new_link_ids = await _import_feed_items(
        db=db,
        feed=feed,
        user_id=current_user.id,
        limit=10,
    )
    await db.commit()
    await db.refresh(feed)

    arq_pool = getattr(request.app.state, "arq_pool", None)
    if arq_pool is not None:
        for link_id in new_link_ids:
            await arq_pool.enqueue_job("classify_link", str(link_id))

    return feed


@router.get("/", response_model=list[FeedResponse])
async def list_feeds(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Feed)
        .where(Feed.user_id == current_user.id)
        .order_by(Feed.created_at.desc())
    )
    return result.scalars().all()


@router.patch("/{feed_id}", response_model=FeedResponse)
async def update_feed(
    feed_id: uuid.UUID,
    body: FeedUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    feed = await _get_feed(feed_id, current_user.id, db)

    if body.status is not None:
        if body.status not in ("active", "paused"):
            raise HTTPException(status_code=400, detail="status must be 'active' or 'paused'")
        feed.status = body.status

    await db.commit()
    await db.refresh(feed)
    return feed


@router.delete("/{feed_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_feed(
    feed_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    feed = await _get_feed(feed_id, current_user.id, db)
    await db.delete(feed)
    await db.commit()


@router.post("/{feed_id}/check-now", response_model=FeedResponse)
async def check_now(
    feed_id: uuid.UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    feed = await _get_feed(feed_id, current_user.id, db)

    arq_pool = getattr(request.app.state, "arq_pool", None)
    if arq_pool is not None:
        await arq_pool.enqueue_job("poll_single_feed", str(feed.id))

    return feed


async def _get_feed(feed_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession) -> Feed:
    result = await db.execute(
        select(Feed).where(Feed.id == feed_id, Feed.user_id == user_id)
    )
    feed = result.scalar_one_or_none()
    if not feed:
        raise HTTPException(status_code=404, detail="Feed not found")
    return feed


async def _import_feed_items(
    db: AsyncSession,
    feed: Feed,
    user_id: uuid.UUID,
    limit: int = 10,
) -> list[uuid.UUID]:
    """Fetch feed, import up to `limit` most recent items. Returns new link IDs."""
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=10.0) as client:
            resp = await client.get(feed.feed_url)
            resp.raise_for_status()
            parsed = parse_feed_content(resp.text)
    except Exception:
        return []

    entries = parsed.entries[:limit]
    new_link_ids: list[uuid.UUID] = []

    for entry in entries:
        guid = entry_guid(entry)
        if not guid:
            continue

        # Skip already seen
        existing_item = await db.execute(
            select(FeedItem).where(FeedItem.feed_id == feed.id, FeedItem.guid == guid)
        )
        if existing_item.scalar_one_or_none():
            continue

        entry_url = entry.get("link", "")
        if not entry_url:
            continue

        try:
            canonical = await canonicalize_url(entry_url)
        except Exception:
            canonical = entry_url

        # Check if link already exists for this user (dedup)
        existing_link = await db.execute(
            select(Link).where(Link.user_id == user_id, Link.canonical_url == canonical)
        )
        link = existing_link.scalar_one_or_none()

        if link is None:
            content_type, queue = classify_by_url(canonical)
            link = Link(
                user_id=user_id,
                feed_id=feed.id,
                url=entry_url,
                canonical_url=canonical,
                title=entry.get("title") or entry_url,
                description=entry.get("summary", "")[:500] if entry.get("summary") else None,
                favicon_url=feed.favicon_url,
                content_type=content_type,
                queue=queue,
                ai_status="pending",
            )
            db.add(link)
            await db.flush()
            new_link_ids.append(link.id)

        feed_item = FeedItem(feed_id=feed.id, guid=guid, link_id=link.id)
        db.add(feed_item)

    feed.total_items_received += len(new_link_ids)
    feed.last_checked_at = datetime.now(timezone.utc)

    return new_link_ids
