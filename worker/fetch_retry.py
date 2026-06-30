import uuid

from api.database import AsyncSessionLocal
from api.models.link import Link
from api.utils.heuristics import classify_by_url
from api.utils.metadata import fetch_metadata


async def retry_unreachable_fetch(ctx, link_id: str) -> None:
    """One-shot retry for links saved with fetch_status=unreachable (FR-L-04)."""
    redis = ctx["redis"]

    async with AsyncSessionLocal() as db:
        link = await db.get(Link, uuid.UUID(link_id))
        if not link or link.fetch_status != "unreachable":
            return

        meta = await fetch_metadata(link.canonical_url)
        link.fetch_status = meta["fetch_status"]

        if meta["fetch_status"] == "ok":
            link.title = link.title or meta["title"]
            link.description = link.description or meta["description"]
            link.favicon_url = link.favicon_url or meta["favicon_url"]

            if link.content_type is None:
                content_type, queue = classify_by_url(link.canonical_url)
                link.content_type = content_type
                link.queue = queue

        await db.commit()

        if meta["fetch_status"] == "ok":
            await redis.enqueue_job("classify_link", link_id)
