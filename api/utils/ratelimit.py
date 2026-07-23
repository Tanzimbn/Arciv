"""Shared slowapi limiter, backed by Redis so limits hold across API workers."""
from datetime import datetime, timezone

from fastapi import HTTPException, status
from slowapi import Limiter
from slowapi.util import get_remote_address

from api.config import settings

limiter = Limiter(key_func=get_remote_address, storage_uri=settings.REDIS_URL)


async def enforce_user_rate_limit(
    redis,
    *,
    scope: str,
    user_id,
    limit: int,
    window: int,
    detail: str,
) -> None:
    """Per-user fixed-window rate limit via a Redis counter.

    Mirrors the counter pattern already used for link creation: INCR a
    key bucketed by (scope, user, time window), set its TTL on first hit,
    and raise 429 once the count exceeds ``limit``. Unlike the slowapi
    ``limiter`` (which keys by client IP), this keys by ``user_id`` so
    authenticated routes aren't collapsed together behind shared NAT.

    No-op when ``redis`` is unavailable (self-host without the arq pool up)
    or ``limit <= 0`` (feature disabled), so self-hosting stays unrestricted.
    """
    if redis is None or limit <= 0:
        return
    bucket = int(datetime.now(timezone.utc).timestamp()) // window
    key = f"rate:{scope}:{user_id}:{bucket}"
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, window)
    if count > limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=detail,
        )
