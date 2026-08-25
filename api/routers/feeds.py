import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.database import get_db
from api.middleware.auth import get_current_user
from api.models.feed import Feed, FeedItem
from api.models.user import User
from api.schemas.feed import (
    FeedCreate,
    FeedDiscoverRequest,
    FeedDiscoverResponse,
    FeedResponse,
    FeedUpdate,
)
from api.utils.feed_discovery import discover_feed, entry_guid, parse_feed_content
from api.utils.ratelimit import enforce_user_rate_limit
from api.utils.safe_fetch import safe_request

router = APIRouter()


@router.post("/discover", response_model=FeedDiscoverResponse)
async def discover(
    body: FeedDiscoverRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    """
    Discover a feed feed from a URL.
    """
    # Up to seven outbound fetches per call (direct, HTML, five common paths),
    # which makes this the cheapest way to make the server do work on someone
    # else's behalf. Limited before any of them go out.
    await enforce_user_rate_limit(
        getattr(request.app.state, "arq_pool", None),
        scope="feeds_discover",
        user_id=current_user.id,
        limit=settings.FEEDS_DISCOVER_PER_MINUTE,
        window=60,
        detail=(
            f"Too fast — max {settings.FEEDS_DISCOVER_PER_MINUTE} feed lookups per minute. "
            "Try again in a moment."
        ),
    )

    try:
        info = await discover_feed(body.url)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
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


@router.post("", response_model=FeedResponse, status_code=status.HTTP_201_CREATED)
async def subscribe(
    body: FeedCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Subscribe to a feed.
    """

    result = await db.execute(
        select(Feed).where(Feed.user_id == current_user.id, Feed.feed_url == body.feed_url)
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already subscribed to this feed.")

    if settings.MAX_FEEDS_PER_USER > 0:
        feed_count = await db.scalar(
            select(func.count()).select_from(Feed).where(Feed.user_id == current_user.id)
        )
        if feed_count >= settings.MAX_FEEDS_PER_USER:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Feed limit reached ({settings.MAX_FEEDS_PER_USER}). Unsubscribe from some to add more.",
            )

    feed = Feed(
        user_id=current_user.id,
        site_url=body.site_url,
        feed_url=body.feed_url,
        title=body.title,
        favicon_url=body.favicon_url,
        category=body.category,
    )
    db.add(feed)
    await db.flush()  # get feed.id before commit

    # Record existing items so the next poll doesn't treat them as new.
    # We intentionally do NOT create Link rows or notify — subscribing is
    # "start watching" only. Future posts published after this moment will
    # generate a notification; the user can manually save any they want.
    await _seed_feed_history(db, feed)
    await db.commit()
    await db.refresh(feed)

    return feed


@router.get("", response_model=list[FeedResponse])
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
    """
    Update a feed. 
    You can update the status of a feed to pause it from being polled.
    The feed will continue to be polled if you resume it.
    You can also update the title of the feed.
    """
    feed = await _get_feed(feed_id, current_user.id, db)

    if body.status is not None:
        if body.status not in ("active", "paused"):
            raise HTTPException(status_code=400, detail="status must be 'active' or 'paused'")
        feed.status = body.status
    if body.category is not None:
        feed.category = body.category

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
    """
    Check a feed now. This will trigger a poll of the feed, and return the feed.
    """
    
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


async def _seed_feed_history(db: AsyncSession, feed: Feed) -> None:
    """Record every current entry's GUID in feed_items with link_id=None so the
    next poll won't treat them as new. Captures ETag/Last-Modified to make the
    next poll a conditional request. Best-effort: if the fetch fails, the next
    poll will still treat the feed as fresh (no GUIDs seeded) — acceptable
    because new items are notification-only, not auto-saved.
    """
    try:
        resp, _final_url = await safe_request("GET", feed.feed_url, timeout=5.0)
        resp.raise_for_status()
        parsed = parse_feed_content(resp.text)
    except Exception:
        return

    for entry in parsed.entries:
        guid = entry_guid(entry)
        if not guid:
            continue
        db.add(FeedItem(feed_id=feed.id, guid=guid, link_id=None))

    feed.last_etag = resp.headers.get("ETag")
    feed.last_modified = resp.headers.get("Last-Modified")
    feed.last_checked_at = datetime.now(timezone.utc)
