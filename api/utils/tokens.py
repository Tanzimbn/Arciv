"""Refresh-token (DB) and single-use email-token (Redis) helpers.

Refresh tokens are stored as SHA-256 hashes in the ``refresh_tokens`` table so a
DB leak doesn't expose usable tokens. Email verification / password-reset tokens
live in Redis with a TTL and are single-use (consumed via GETDEL).
"""
import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import redis.asyncio as aioredis
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.models.refresh_token import RefreshToken


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# --------------------------------------------------------------------------- #
# Refresh tokens (Postgres)
# --------------------------------------------------------------------------- #
async def create_refresh_token(
    db: AsyncSession,
    user_id: uuid.UUID,
    user_agent: str | None = None,
    ip: str | None = None,
) -> str:
    """Create + persist a refresh token; return the raw (unhashed) value."""
    raw = secrets.token_urlsafe(32)
    db.add(
        RefreshToken(
            user_id=user_id,
            token_hash=hash_token(raw),
            expires_at=datetime.now(timezone.utc)
            + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
            user_agent=(user_agent or None) and user_agent[:255],
            ip=ip,
        )
    )
    await db.commit()
    return raw


async def get_valid_refresh_token(db: AsyncSession, raw: str) -> RefreshToken | None:
    res = await db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw))
    )
    tok = res.scalar_one_or_none()
    if not tok or tok.revoked or _aware(tok.expires_at) < datetime.now(timezone.utc):
        return None
    return tok


async def revoke_refresh_token(db: AsyncSession, raw: str) -> None:
    res = await db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw))
    )
    tok = res.scalar_one_or_none()
    if tok and not tok.revoked:
        tok.revoked = True
        await db.commit()


async def revoke_all_for_user(db: AsyncSession, user_id: uuid.UUID) -> None:
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked.is_(False))
        .values(revoked=True)
    )
    await db.commit()


# --------------------------------------------------------------------------- #
# Email tokens (Redis, single-use, TTL)
# --------------------------------------------------------------------------- #
async def issue_email_token(kind: str, user_id: uuid.UUID, ttl_hours: int) -> str:
    """Store a hashed single-use token under ``<kind>:<hash>`` and return the raw token."""
    raw = secrets.token_urlsafe(32)
    r = aioredis.from_url(settings.REDIS_URL)
    await r.set(f"{kind}:{hash_token(raw)}", str(user_id), ex=ttl_hours * 3600)
    await r.aclose()
    return raw


async def consume_email_token(kind: str, raw: str) -> str | None:
    """Atomically fetch + delete the token. Returns the user_id or None."""
    r = aioredis.from_url(settings.REDIS_URL)
    value = await r.getdel(f"{kind}:{hash_token(raw)}")
    await r.aclose()
    if value is None:
        return None
    return value.decode() if isinstance(value, bytes) else value