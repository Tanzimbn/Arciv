import uuid
from datetime import datetime, timezone

import httpx
from sqlalchemy import select

from api.database import AsyncSessionLocal
from api.models.feed import Feed, FeedItem
from api.models.link import Link
from api.models.notification import Notification
from api.utils.feed_discovery import entry_guid, parse_feed_content
from api.utils.heuristics import classify_by_url
from api.utils.metadata import canonicalize_url

DEGRADED_THRESHOLD = 7
DEAD_THRESHOLD = 30


async def poll_single_feed(ctx, feed_id: str) -> None:
    redis = ctx["redis"]
    async with AsyncSessionLocal() as db:
        feed = await db.get(Feed, uuid.UUID(feed_id))
        if not feed or feed.status == "paused":
            return

        headers = {}
        if feed.last_etag:
            headers["If-None-Match"] = feed.last_etag
        if feed.last_modified:
            headers["If-Modified-Since"] = feed.last_modified

        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as client:
                resp = await client.get(feed.feed_url, headers=headers)

            now = datetime.now(timezone.utc)

            if resp.status_code == 304:
                feed.last_checked_at = now
                await db.commit()
                return

            resp.raise_for_status()

            parsed = parse_feed_content(resp.text)
            new_link_ids = await _process_entries(db, feed, parsed.entries)

            feed.last_checked_at = now
            feed.last_etag = resp.headers.get("ETag")
            feed.last_modified = resp.headers.get("Last-Modified")
            feed.consecutive_failures = 0
            feed.total_items_received += len(new_link_ids)

            if new_link_ids:
                notif = Notification(
                    user_id=feed.user_id,
                    type="new_feed_items",
                    title=f"{feed.title or feed.feed_url} has {len(new_link_ids)} new post(s)",
                    body=None,
                )
                db.add(notif)

            await db.commit()

            for link_id in new_link_ids:
                await redis.enqueue_job("classify_link", str(link_id))

        except Exception as e:
            async with AsyncSessionLocal() as db2:
                feed2 = await db2.get(Feed, uuid.UUID(feed_id))
                if not feed2:
                    return
                feed2.consecutive_failures += 1
                feed2.last_checked_at = datetime.now(timezone.utc)

                if feed2.consecutive_failures == DEAD_THRESHOLD:
                    feed2.status = "dead"
                    notif = Notification(
                        user_id=feed2.user_id,
                        type="feed_dead",
                        title=f"{feed2.title or feed2.feed_url} hasn't been reachable for 30 days. Remove it?",
                    )
                    db2.add(notif)
                elif feed2.consecutive_failures >= DEGRADED_THRESHOLD:
                    if feed2.status == "active":
                        feed2.status = "degraded"

                await db2.commit()


async def poll_all_feeds(ctx) -> None:
    redis = ctx["redis"]
    await redis.set("arciv:last_feed_poll", datetime.now(timezone.utc).isoformat())

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Feed.id).where(Feed.status.in_(["active", "degraded"]))
        )
        feed_ids = [str(r) for r in result.scalars().all()]

    for feed_id in feed_ids:
        await redis.enqueue_job("poll_single_feed", feed_id)


async def _process_entries(db, feed: Feed, entries) -> list[uuid.UUID]:
    new_link_ids: list[uuid.UUID] = []

    for entry in entries:
        guid = entry_guid(entry)
        if not guid:
            continue

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

        existing_link = await db.execute(
            select(Link).where(Link.user_id == feed.user_id, Link.canonical_url == canonical)
        )
        link = existing_link.scalar_one_or_none()

        if link is None:
            content_type, queue = classify_by_url(canonical)
            link = Link(
                user_id=feed.user_id,
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

    return new_link_ids
