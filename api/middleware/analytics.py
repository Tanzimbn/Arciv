"""Lightweight traffic analytics via Redis aggregate counters.

Per request we bump three per-day keys (never one row/key *per request*, so this
stays tiny — a handful of keys per day, HLL is ~12 KB max regardless of volume):

    stats:req:<YYYY-MM-DD>   INCR   total requests
    stats:err:<YYYY-MM-DD>   INCR   responses with status >= 400
    stats:uv:<YYYY-MM-DD>    PFADD  hashed client IP (HyperLogLog unique visitors)

Client IPs are SHA-256 hashed before storage — raw IPs are never persisted. All
Redis work is best-effort: any failure is swallowed so metrics never break a
request. Keys carry a 90-day TTL and expire on their own (no prune job).
"""
import hashlib
from datetime import datetime, timezone

from slowapi.util import get_remote_address

# Paths that are noise for traffic (health probes, API docs, built assets). The
# SPA document load and every /api/* call still count as real traffic.
_SKIP_EXACT = {"/health", "/docs", "/redoc", "/openapi.json", "/favicon.ico"}
_SKIP_PREFIX = ("/assets/",)
_SKIP_METHODS = {"HEAD", "OPTIONS"}

_TTL_SECONDS = 90 * 24 * 3600


def _hash_ip(ip: str) -> str:
    return hashlib.sha256(ip.encode()).hexdigest()[:16]


def _should_count(method: str, path: str) -> bool:
    if method in _SKIP_METHODS:
        return False
    if path in _SKIP_EXACT:
        return False
    if any(path.startswith(p) for p in _SKIP_PREFIX):
        return False
    return True


async def traffic_middleware(request, call_next):
    response = await call_next(request)

    if not _should_count(request.method, request.url.path):
        return response

    redis = getattr(request.app.state, "analytics_redis", None)
    if redis is not None:
        try:
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            ip_hash = _hash_ip(get_remote_address(request))
            pipe = redis.pipeline(transaction=False)
            pipe.incr(f"stats:req:{today}")
            pipe.expire(f"stats:req:{today}", _TTL_SECONDS)
            pipe.pfadd(f"stats:uv:{today}", ip_hash)
            pipe.expire(f"stats:uv:{today}", _TTL_SECONDS)
            if response.status_code >= 400:
                pipe.incr(f"stats:err:{today}")
                pipe.expire(f"stats:err:{today}", _TTL_SECONDS)
            await pipe.execute()
        except Exception:
            pass  # metrics are best-effort — never break the request

    return response
