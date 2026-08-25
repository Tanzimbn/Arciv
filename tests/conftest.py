"""Shared test configuration and fixtures.

The suite has two layers:

* **unit** — pure functions, no services. Encryption, storage accounting, URL
  canonicalisation, the SSRF guard, heuristics, captcha fail-closed behaviour.
* **integration** (``@pytest.mark.integration``) — the real FastAPI app against a
  real Postgres (pgvector) and Redis. This is where the tenancy, quota and
  rate-limit invariants are actually enforced, so they are tested against real
  SQL and real Redis counters rather than mocks.

Integration tests are skipped when the services aren't reachable, *unless*
``ARCIV_REQUIRE_SERVICES=1`` — CI sets that so a missing service fails the build
instead of silently shrinking the suite.

Nothing here reaches the public internet: outbound metadata/article fetches are
stubbed for every request-level test.
"""
from __future__ import annotations

import asyncio
import hashlib
import math
import os
import re
import socket
import subprocess
import sys
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import pytest

ROOT = Path(__file__).resolve().parent.parent

# --------------------------------------------------------------------------- #
# Environment — must be set before anything imports api.config
# --------------------------------------------------------------------------- #
# pydantic-settings reads the process environment *and* the repo's .env, with the
# process environment winning. We therefore force every setting the suite depends
# on, so a developer's .env can never change what the tests assert.
_FALLBACK_DATABASE_URL = "postgresql://arciv:arciv@localhost:5432/arciv_test"
_FALLBACK_REDIS_URL = "redis://localhost:6379/15"

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL") or _FALLBACK_DATABASE_URL
TEST_REDIS_URL = os.environ.get("TEST_REDIS_URL") or _FALLBACK_REDIS_URL

# The suite TRUNCATEs every table between tests. Refuse to run against anything
# that isn't obviously a throwaway database.
_DB_NAME = urlsplit(TEST_DATABASE_URL).path.lstrip("/")
if not _DB_NAME.endswith("_test"):
    raise RuntimeError(
        f"Refusing to run: test database name {_DB_NAME!r} does not end in '_test'. "
        "The suite truncates every table between tests. Set TEST_DATABASE_URL to a "
        "dedicated database (e.g. postgresql://arciv:arciv@localhost:5432/arciv_test)."
    )

os.environ.update(
    {
        "DATABASE_URL": TEST_DATABASE_URL,
        "REDIS_URL": TEST_REDIS_URL,
        "SECRET_KEY": "test-jwt-secret-not-used-anywhere-real",
        "ENCRYPTION_KEY": "test-encryption-key-0000000000000000",
        "ENCRYPTION_KEY_ID": "1",
        "ENCRYPTION_KEYS_RETIRED": "",
        "ENVIRONMENT": "test",
        # No model download, no 400MB resident: tests that exercise search patch
        # embed_text and flip this on for the duration.
        "EMBEDDINGS_ENABLED": "false",
        "EMBED_SERVICE_URL": "",
        "EMAIL_ENABLED": "false",
        "TELEGRAM_ENABLED": "false",
        "SHARED_GEMINI_KEY": "",
        "ADMIN_EMAILS": "",
        "APP_BASE_URL": "http://test.local",
        # Guards default to off/unlimited; each test opts in via monkeypatch so
        # limits are always asserted against an explicit value.
        "MAX_LINKS_PER_USER": "0",
        "MAX_FEEDS_PER_USER": "0",
        "MAX_STORAGE_BYTES_PER_USER": "0",
        "LINKS_CREATE_PER_MINUTE": "0",
        "SEARCH_PER_MINUTE": "0",
        "INSIGHTS_PER_MINUTE": "0",
        "BLOCK_DISPOSABLE_EMAILS": "false",
        "SIGNUPS_PER_DAY_GLOBAL": "0",
        "TURNSTILE_SECRET_KEY": "",
        # slowapi's per-IP auth limits are real and shared across tests in a
        # session; keep them out of the way except where a test sets its own.
        "AUTH_REGISTER_RATE_LIMIT": "10000/hour",
        "AUTH_LOGIN_RATE_LIMIT": "10000/minute",
        "AUTH_VERIFY_EMAIL_RATE_LIMIT": "10000/hour",
        "AUTH_RESEND_VERIFICATION_RATE_LIMIT": "10000/hour",
        "AUTH_FORGOT_PASSWORD_RATE_LIMIT": "10000/hour",
        "AUTH_RESET_PASSWORD_RATE_LIMIT": "10000/hour",
    }
)

TEST_PASSWORD = "Testpass123"

# Redis key prefixes this app writes. Cleared between tests instead of FLUSHDB so
# pointing TEST_REDIS_URL at a shared Redis can't wipe unrelated data.
_REDIS_PREFIXES = (
    "rate:",
    "signups:",
    "verify:",
    "reset:",
    "embed:q:",
    "stats:",
    "ai_usage:",
    "ai_config_alert:",
    "ai_models:",
    "arciv:",
    "LIMITER",  # slowapi / limits storage
)


# --------------------------------------------------------------------------- #
# Service availability
# --------------------------------------------------------------------------- #
def _reachable(url: str, default_port: int) -> bool:
    parts = urlsplit(url)
    host, port = parts.hostname or "localhost", parts.port or default_port
    try:
        with socket.create_connection((host, port), timeout=1.0):
            return True
    except OSError:
        return False


SERVICES_UP = _reachable(TEST_DATABASE_URL, 5432) and _reachable(TEST_REDIS_URL, 6379)
REQUIRE_SERVICES = os.environ.get("ARCIV_REQUIRE_SERVICES") == "1"


def pytest_collection_modifyitems(config, items):
    """Skip the integration layer when Postgres/Redis aren't up.

    CI sets ARCIV_REQUIRE_SERVICES=1, which turns the skip off — an unreachable
    service must fail the build, not quietly reduce coverage.
    """
    if SERVICES_UP or REQUIRE_SERVICES:
        return
    skip = pytest.mark.skip(
        reason=(
            f"needs Postgres ({TEST_DATABASE_URL}) + Redis ({TEST_REDIS_URL}); "
            "see tests/README.md"
        )
    )
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(skip)


# --------------------------------------------------------------------------- #
# Schema: create the database if needed, then run the real migrations
# --------------------------------------------------------------------------- #
async def _create_database_if_missing() -> None:
    import asyncpg

    parts = urlsplit(TEST_DATABASE_URL)
    admin_dsn = urlunsplit(("postgresql", parts.netloc, "/postgres", "", ""))
    conn = await asyncpg.connect(admin_dsn)
    try:
        exists = await conn.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", _DB_NAME)
        if not exists:
            # No parameter binding in CREATE DATABASE; the name comes from our own
            # validated env var, not from user input.
            await conn.execute(f'CREATE DATABASE "{_DB_NAME}"')
    finally:
        await conn.close()


@pytest.fixture(scope="session")
def migrated_database() -> None:
    """Bring the test database to head using Alembic — the same path production
    uses in bin/start.sh, so a broken migration chain fails here too."""
    asyncio.run(_create_database_if_missing())
    proc = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=ROOT,
        env=os.environ.copy(),
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        pytest.fail(f"alembic upgrade head failed:\n{proc.stdout}\n{proc.stderr}")


@pytest.fixture(scope="session")
async def engine(migrated_database):
    """The app's own engine (already pointed at the test database by the env
    block above). Disposed at session end so no asyncpg connection outlives the
    event loop it was opened on."""
    from api.database import engine as app_engine

    yield app_engine
    await app_engine.dispose()


@pytest.fixture(scope="session")
async def redis_client():
    import redis.asyncio as aioredis

    client = aioredis.from_url(TEST_REDIS_URL)
    yield client
    await client.aclose()


@pytest.fixture
async def clean_state(engine, redis_client):
    """Empty every table and drop the app's Redis keys before each test."""
    from sqlalchemy import text

    async with engine.begin() as conn:
        rows = await conn.execute(
            text(
                "SELECT tablename FROM pg_tables "
                "WHERE schemaname = 'public' AND tablename <> 'alembic_version'"
            )
        )
        tables = [r[0] for r in rows]
        if tables:
            quoted = ", ".join(f'"{t}"' for t in tables)
            await conn.execute(text(f"TRUNCATE TABLE {quoted} RESTART IDENTITY CASCADE"))

    for prefix in _REDIS_PREFIXES:
        keys = [k async for k in redis_client.scan_iter(match=f"{prefix}*", count=500)]
        if keys:
            await redis_client.delete(*keys)
    yield


# --------------------------------------------------------------------------- #
# Test doubles
# --------------------------------------------------------------------------- #
class FakeArqPool:
    """Stands in for ``app.state.arq_pool``.

    Job enqueues are recorded instead of dispatched (there is no worker in the
    suite), but every Redis operation goes to the real Redis — the rate limiters
    and the signup counter are exactly the INCR/EXPIRE behaviour we want to test.
    """

    def __init__(self, redis):
        self._redis = redis
        self.jobs: list[tuple[str, tuple, dict]] = []

    async def enqueue_job(self, name: str, *args, **kwargs):
        self.jobs.append((name, args, kwargs))
        return None

    def job_args(self, name: str) -> list[tuple]:
        return [args for job_name, args, _ in self.jobs if job_name == name]

    async def incr(self, key):
        return await self._redis.incr(key)

    async def expire(self, key, seconds):
        return await self._redis.expire(key, seconds)

    async def get(self, key):
        return await self._redis.get(key)

    async def set(self, key, value, ex=None, nx=False):
        return await self._redis.set(key, value, ex=ex, nx=nx)


def canonicalize_offline(url: str) -> str:
    """Network-free stand-in for ``canonicalize_url``.

    Applies the same tracking-param strip + trailing-slash rule, minus the
    redirect fetch. The real function's behaviour is covered separately in
    tests/test_url_canonicalisation.py with the HTTP layer faked.

    It deliberately runs no SSRF check: the real one resolves DNS (see
    api/utils/safe_fetch.py) and a stub that fakes that would be asserting
    against itself. Tests that care about the guard use the real
    ``canonicalize_url`` — tests/integration/test_outbound_guard.py.
    """
    from api.utils.metadata import TRACKING_PARAMS

    parts = urlsplit(url)
    params = parse_qs(parts.query, keep_blank_values=True)
    query = urlencode({k: v for k, v in params.items() if k not in TRACKING_PARAMS}, doseq=True)
    return urlunsplit((parts.scheme, parts.netloc, parts.path.rstrip("/") or "/", query, ""))


def fake_vector(text: str, dim: int = 384) -> list[float]:
    """Deterministic hashed bag-of-words vector — a stand-in for a real model.

    Hashing whole strings would be deterministic but semantically meaningless:
    two texts sharing every word but one would land as far apart as two
    unrelated ones, so a cosine-ordering assertion would only be testing hash
    luck. Hashing *tokens* into buckets keeps shared vocabulary close, which is
    the one property the search tests actually depend on. The pgvector distance
    computation and ordering exercised on top of it are real.
    """
    vec = [0.0] * dim
    for token in re.findall(r"[a-z0-9]+", text.lower()):
        digest = hashlib.sha256(token.encode()).digest()
        for k in range(4):  # a few buckets per token to cut collisions
            vec[int.from_bytes(digest[4 * k : 4 * k + 4], "big") % dim] += 1.0
    norm = math.sqrt(sum(v * v for v in vec))
    if norm == 0:  # no tokens — cosine distance against a zero vector is NaN
        return [1.0 / math.sqrt(dim)] * dim
    return [v / norm for v in vec]


@pytest.fixture
def no_network():
    """Turn any real outbound HTTP request into a test failure.

    Only the real network transport is patched — the ASGI test client rides
    ``ASGITransport``, a different class, so in-process requests keep working.
    """
    import httpx

    real_handle = httpx.AsyncHTTPTransport.handle_async_request

    async def _blocked(self, request):
        raise AssertionError(
            f"unexpected outbound HTTP request in tests: {request.method} {request.url}"
        )

    httpx.AsyncHTTPTransport.handle_async_request = _blocked
    try:
        yield
    finally:
        httpx.AsyncHTTPTransport.handle_async_request = real_handle


# --------------------------------------------------------------------------- #
# App client
# --------------------------------------------------------------------------- #
@pytest.fixture
async def app_state(clean_state, redis_client, no_network):
    """The FastAPI app with a fake arq pool attached and all outbound HTTP
    stubbed. Returns the pool so tests can assert on enqueued jobs."""
    from api import main as api_main
    from api.routers import links as links_router

    pool = FakeArqPool(redis_client)
    api_main.app.state.arq_pool = pool

    async def _fetch_metadata(url: str) -> dict:
        return {
            "title": f"Title for {url}",
            "description": "Stub description.",
            "favicon_url": "https://example.com/favicon.ico",
            "published_date": None,
            "fetch_status": "ok",
        }

    async def _fetch_article_text(url: str, max_chars: int = 6000) -> str:
        return "Stub article body."

    async def _canonicalize(url: str) -> str:
        return canonicalize_offline(url)

    originals = {
        "fetch_metadata": links_router.fetch_metadata,
        "fetch_article_text": links_router.fetch_article_text,
        "canonicalize_url": links_router.canonicalize_url,
    }
    links_router.fetch_metadata = _fetch_metadata
    links_router.fetch_article_text = _fetch_article_text
    links_router.canonicalize_url = _canonicalize

    try:
        yield pool
    finally:
        for name, fn in originals.items():
            setattr(links_router, name, fn)
        api_main.app.state.arq_pool = None


@pytest.fixture
async def client(app_state):
    import httpx

    from api.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def session_factory(engine):
    from api.database import AsyncSessionLocal

    return AsyncSessionLocal


@pytest.fixture
async def make_user(session_factory):
    """Insert a verified user directly and return ``(user_id, auth_headers)``.

    Bypasses the register/verify/login round-trip (covered on its own in
    tests/integration/test_auth_flow.py) so isolation and quota tests aren't
    paying for three bcrypt hashes each.
    """
    from api.middleware.auth import create_access_token
    from api.models.user import User
    from api.utils.security import hash_password

    async def _make(email: str | None = None, password: str = TEST_PASSWORD, **fields):
        email = email or f"user-{uuid.uuid4().hex[:8]}@example.com"
        async with session_factory() as db:
            user = User(
                email=email,
                password_hash=hash_password(password),
                email_verified=True,
                username=f"u{uuid.uuid4().hex[:10]}",
                **fields,
            )
            db.add(user)
            await db.commit()
            await db.refresh(user)
        headers = {"Authorization": f"Bearer {create_access_token(user.id)}"}
        return user.id, headers

    return _make
