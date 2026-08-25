import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from agent.errors import AuthError, ModelError, ParseError, QuotaError, human_message
from agent.registry import make_provider
from api.config import settings
from api.database import AsyncSessionLocal
from api.models.link import Link
from api.models.notification import Notification
from api.models.user import User
from api.utils.encryption import decrypt_secret
from api.utils.heuristics import classify_by_url
from api.utils.storage import adjust_user_storage, link_bytes

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
        api_key = decrypt_secret(user.ai_api_key_enc)
        return make_provider(user.ai_provider, api_key, user.ai_model), user.ai_provider

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


async def _notify_ai_config_broken(db, redis, user: User, kind: str, message: str) -> None:
    """Tell the user once a day that their AI settings are broken.

    The body carries `human_message`, not the raw SDK string: a notification is
    read, not debugged, and `Error code: 401 - {'error': {'message': …}}` buries
    the four words that matter. `link.ai_error` keeps the raw text.

    Once, not once per link: a bad model breaks every link the user saves, and 50
    identical notifications is the same as none. The dedupe is a Redis ``SET NX
    EX``, matching the shared-key daily counter above. Without redis we skip the
    notification rather than write one per link — the link row still carries
    ``ai_error``.
    """
    if redis is None:
        return

    acquired = await redis.set(f"ai_config_alert:{user.id}", "1", ex=86400, nx=True)
    if not acquired:
        return

    title = (
        "AI model unavailable" if kind == "model" else "AI provider rejected your key"
    )
    hint = (
        "Pick a different model in Settings, then retry the link."
        if kind == "model"
        else "Update your API key in Settings, then retry the link."
    )
    db.add(
        Notification(
            user_id=user.id,
            type="ai_config",
            title=title,
            body=f"{user.ai_provider}: {human_message(message)}\n\n{hint}",
        )
    )
    await db.commit()


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

            # Account the bytes the AI just added (summary/tags/raw JSON are the
            # dominant per-link footprint). Every branch that writes ai_error
            # accounts for it too — it is in storage._TEXT_FIELDS.
            before = link_bytes(link)
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
            await adjust_user_storage(db, link.user_id, link_bytes(link) - before)
            await db.commit()
            # Re-embed now that summary + tags exist, to enrich the vector.
            await redis.enqueue_job("embed_link", link_id)

        except (ModelError, AuthError) as e:
            # Permanent and user-fixable: a retired/unknown model or rejected
            # credentials. The identical request cannot start working, so the
            # backoff ladder would only spend ~72 minutes hiding the problem —
            # and then sweep_failed_links would resurrect it hourly, leaving the
            # link stuck on "Classifying…" forever. Mark it terminal and tell
            # the user instead.
            kind = "model" if isinstance(e, ModelError) else "credentials"
            before = link_bytes(link)
            link.ai_status = "failed"
            link.ai_error_kind = "config"
            link.ai_error = f"AI {kind} error: {e}"
            await db.commit()
            await adjust_user_storage(db, link.user_id, link_bytes(link) - before)
            await db.commit()
            await _notify_ai_config_broken(db, redis, user, kind, str(e))

        except ParseError:
            ct, q = classify_by_url(link.canonical_url)
            link.content_type = ct
            link.queue = q
            link.ai_status = "skipped"
            link.ai_provider_used = "heuristic"
            link.ai_error = None
            await db.commit()

        except (QuotaError, Exception) as e:
            before = link_bytes(link)
            link.ai_error = str(e)
            if attempt >= MAX_ATTEMPTS:
                link.ai_status = "failed"
                await db.commit()
                await adjust_user_storage(db, link.user_id, link_bytes(link) - before)
                await db.commit()
            else:
                delay = _RETRY_DELAYS[attempt - 1]
                link.ai_status = "pending"
                link.ai_next_retry_at = datetime.now(timezone.utc) + delay
                await db.commit()
                await adjust_user_storage(db, link.user_id, link_bytes(link) - before)
                await db.commit()
                await redis.enqueue_job(
                    "classify_link", link_id, _defer_by=delay
                )


async def sweep_failed_links(ctx) -> None:
    """Requeue transiently-failed links for reprocessing (runs hourly).

    Links marked ``ai_error_kind="config"`` are left alone: a retired model or a
    revoked key cannot be fixed by trying again, and requeueing them puts the link
    back into ``pending``, which the UI renders as "Classifying…".
    """
    redis = ctx["redis"]
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Link).where(
                Link.ai_status == "failed",
                # IS DISTINCT FROM, not !=: a plain inequality is NULL for every
                # row written before ai_error_kind existed, which would silently
                # stop retrying *all* transient failures.
                Link.ai_error_kind.is_distinct_from("config"),
            )
        )
        links = result.scalars().all()
        for link in links:
            link.ai_attempt_count = 0
            link.ai_status = "pending"
        await db.commit()

    for link in links:
        await redis.enqueue_job("classify_link", str(link.id))
