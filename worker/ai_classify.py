import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from agent.prompt import AuthError, ParseError, QuotaError
from agent.registry import make_provider
from api.config import settings
from api.database import AsyncSessionLocal
from api.models.link import Link
from api.models.user import User
from api.utils.encryption import decrypt_value
from api.utils.heuristics import classify_by_url

_RETRY_DELAYS = [
    timedelta(minutes=2),
    timedelta(minutes=10),
    timedelta(hours=1),
]
MAX_ATTEMPTS = 4
SHARED_DAILY_LIMIT = 20


async def _get_provider(user: User, redis):
    """Return (provider, provider_name) or (None, None) if no provider available."""
    if user.ai_api_key_enc:
        api_key = decrypt_value(user.ai_api_key_enc, settings.ENCRYPTION_KEY)
        return make_provider(user.ai_provider, api_key), user.ai_provider

    if settings.SHARED_GEMINI_KEY:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        redis_key = f"ai_usage:{user.id}:{today}"
        count = await redis.incr(redis_key)
        if count == 1:
            await redis.expire(redis_key, 86400)
        if count > SHARED_DAILY_LIMIT:
            await redis.decr(redis_key)
            return None, None
        return make_provider("gemini", settings.SHARED_GEMINI_KEY), "gemini-shared"

    return None, None


async def classify_link(ctx, link_id: str) -> None:
    redis = ctx["redis"]

    async with AsyncSessionLocal() as db:
        link = await db.get(Link, uuid.UUID(link_id))
        if not link or link.ai_status == "done":
            return

        user = await db.get(User, link.user_id)
        if not user:
            return

        attempt = link.ai_attempt_count + 1
        link.ai_attempt_count = attempt
        link.ai_status = "processing"
        await db.commit()

        try:
            provider, provider_name = await _get_provider(user, redis)

            if provider is None:
                link.ai_status = "pending"
                await db.commit()
                return

            result = await provider.classify_and_summarise(
                title=link.title or "",
                content=link.description or "",
                url=link.canonical_url,
            )

            if result is None:
                raise RuntimeError("Provider returned None")

            link.content_type = result.content_type
            link.queue = result.queue
            link.ai_summary = result.summary
            link.ai_tags = result.tags
            link.ai_raw_response = result.raw_response
            link.ai_status = "done"
            link.ai_provider_used = provider_name
            link.ai_error = None
            link.processed_at = datetime.now(timezone.utc)
            await db.commit()

        except AuthError as e:
            link.ai_status = "failed"
            link.ai_error = f"Auth error: {e}"
            await db.commit()

        except ParseError:
            ct, q = classify_by_url(link.canonical_url)
            link.content_type = ct
            link.queue = q
            link.ai_status = "skipped"
            link.ai_provider_used = "heuristic"
            link.ai_error = None
            await db.commit()

        except (QuotaError, Exception) as e:
            link.ai_error = str(e)
            if attempt >= MAX_ATTEMPTS:
                link.ai_status = "failed"
                await db.commit()
            else:
                delay = _RETRY_DELAYS[attempt - 1]
                link.ai_status = "pending"
                link.ai_next_retry_at = datetime.now(timezone.utc) + delay
                await db.commit()
                await redis.enqueue_job(
                    "classify_link", link_id, _defer_by=delay
                )


async def sweep_failed_links(ctx) -> None:
    """Requeue all ai-failed links for reprocessing (runs hourly)."""
    redis = ctx["redis"]
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Link).where(Link.ai_status == "failed")
        )
        links = result.scalars().all()
        for link in links:
            link.ai_attempt_count = 0
            link.ai_status = "pending"
        await db.commit()

    for link in links:
        await redis.enqueue_job("classify_link", str(link.id))
