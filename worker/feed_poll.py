import uuid
from datetime import datetime, timezone

from sqlalchemy import select

from api.database import AsyncSessionLocal
from api.models.feed import Feed, FeedItem
from api.models.notification import Notification
from api.utils.feed_discovery import entry_guid, parse_feed_content
from api.utils.safe_fetch import safe_request

DEGRADED_THRESHOLD = 7
DEAD_THRESHOLD = 30
MAX_NOTIFICATION_ITEMS = 50


async def poll_single_feed(ctx, feed_id: str) -> None:
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
            # A stored feed_url is still user input, and the name it points at can
            # start resolving somewhere private long after the user subscribed —
            # so the poll validates on every run, not just at subscribe time.
            resp, _final_url = await safe_request(
                "GET", feed.feed_url, headers=headers, timeout=15.0
            )

            now = datetime.now(timezone.utc)

            if resp.status_code == 304:
                feed.last_checked_at = now
                feed.consecutive_failures = 0
                if feed.status == "degraded":
                    feed.status = "active"
                await db.commit()
                return

            resp.raise_for_status()

            parsed = parse_feed_content(resp.text)
            new_items = await _process_entries(db, feed, parsed.entries)

            feed.last_checked_at = now
            feed.last_etag = resp.headers.get("ETag")
            feed.last_modified = resp.headers.get("Last-Modified")
            feed.consecutive_failures = 0
            if feed.status == "degraded":
                feed.status = "active"
            feed.total_items_received += len(new_items)

            if new_items:
                source = feed.title or feed.feed_url
                shown = new_items[:MAX_NOTIFICATION_ITEMS]
                body_lines = [f"• {item['title']}\n  {item['url']}" for item in shown]
                if len(new_items) > MAX_NOTIFICATION_ITEMS:
                    body_lines.append(f"\n... and {len(new_items) - MAX_NOTIFICATION_ITEMS} more")
                site = feed.site_url or feed.feed_url
                body = f"source: {site}\n\n" + "\n\n".join(body_lines)
                notif = Notification(
                    user_id=feed.user_id,
                    type="new_feed_items",
                    title=f"{source} has {len(new_items)} new post{'s' if len(new_items) > 1 else ''}",
                    body=body,
                )
                db.add(notif)

            await db.commit()

        except Exception:
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


async def _process_entries(db, feed: Feed, entries) -> list[dict]:
    """Record new GUIDs in feed_items (with link_id=None) and return the
    title+url of each new entry so the caller can build a notification.
    No Link rows are created — the user manually saves any post they want
    via the existing POST /api/links endpoint.
    """
    new_items: list[dict] = []

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

        db.add(FeedItem(feed_id=feed.id, guid=guid, link_id=None))
        new_items.append({
            "title": entry.get("title") or entry_url,
            "url": entry_url,
        })

    return new_items
