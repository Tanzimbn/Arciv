"""Embedding jobs for semantic search.

Embeddings are local + free (fastembed), so they must NOT be gated behind AI
provider availability — a link with no configured AI provider still gets a vector
and is searchable. Hence a dedicated job rather than piggybacking on classify.
"""
import uuid

from sqlalchemy import select

from agent.embedding import embed_text
from api.config import settings
from api.database import AsyncSessionLocal
from api.models.link import Link
from api.utils.storage import EMBEDDING_BYTES, adjust_user_storage

_BACKFILL_BATCH = 200


def _embedding_text(link: Link) -> str:
    parts = [link.title, link.description, link.ai_summary]
    if link.ai_tags:
        parts.append(" ".join(link.ai_tags))
    return "\n".join(p for p in parts if p).strip()


async def embed_link(ctx, link_id: str) -> None:
    """Compute + store the embedding for one link. Idempotent; no-op when
    embeddings are disabled or the link has no usable text."""
    if not settings.EMBEDDINGS_ENABLED:
        return
    async with AsyncSessionLocal() as db:
        link = await db.get(Link, uuid.UUID(link_id))
        if not link:
            return
        vec = await embed_text(_embedding_text(link))
        if vec is None:
            return
        had_embedding = link.embedding is not None
        link.embedding = vec
        await db.commit()
        # A vector is a fixed +1536 bytes, counted once (re-embeds don't re-add).
        if not had_embedding:
            await adjust_user_storage(db, link.user_id, EMBEDDING_BYTES)
            await db.commit()


async def backfill_embeddings(ctx) -> None:
    """Enqueue embedding for links still missing a vector (hourly cron)."""
    if not settings.EMBEDDINGS_ENABLED:
        return
    redis = ctx["redis"]
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Link.id).where(Link.embedding.is_(None)).limit(_BACKFILL_BATCH)
        )
        ids = [str(link_id) for link_id in result.scalars().all()]
    for link_id in ids:
        await redis.enqueue_job("embed_link", link_id)
