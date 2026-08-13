"""Per-user rate limits on non-auth routes (NFR-PUB-02).

These are burst guards on server work (outbound fetches, CPU embeds), keyed by
user_id rather than IP so users behind shared NAT aren't collapsed together.
The Redis counters are real here — the fake arq pool proxies incr/expire through
to the live Redis instance.
"""
import pytest

pytestmark = pytest.mark.integration


async def test_link_create_rate_limit_returns_429(client, app_state, make_user, monkeypatch):
    from api.config import settings

    monkeypatch.setattr(settings, "LINKS_CREATE_PER_MINUTE", 3)
    _, alice = await make_user()

    codes = [
        (await client.post("/api/links", json={"url": f"https://example.com/r{i}"}, headers=alice)).status_code
        for i in range(5)
    ]
    assert codes[:3] == [201, 201, 201]
    assert codes[3:] == [429, 429], codes


async def test_rate_limit_counters_are_per_user(client, app_state, make_user, monkeypatch):
    from api.config import settings

    monkeypatch.setattr(settings, "LINKS_CREATE_PER_MINUTE", 1)
    _, alice = await make_user("alice@example.com")
    _, bob = await make_user("bob@example.com")

    assert (await client.post("/api/links", json={"url": "https://example.com/a"}, headers=alice)).status_code == 201
    assert (await client.post("/api/links", json={"url": "https://example.com/b"}, headers=alice)).status_code == 429
    # Bob's bucket is independent.
    assert (await client.post("/api/links", json={"url": "https://example.com/c"}, headers=bob)).status_code == 201


async def test_zero_disables_the_limit(client, app_state, make_user, monkeypatch):
    from api.config import settings

    monkeypatch.setattr(settings, "LINKS_CREATE_PER_MINUTE", 0)
    _, alice = await make_user()
    for i in range(6):
        r = await client.post("/api/links", json={"url": f"https://example.com/u{i}"}, headers=alice)
        assert r.status_code == 201


async def test_rate_limit_key_is_scoped_and_expires(client, app_state, make_user, redis_client, monkeypatch):
    """The counter must carry a TTL, or one burst locks the user out forever."""
    from api.config import settings

    monkeypatch.setattr(settings, "LINKS_CREATE_PER_MINUTE", 2)
    user_id, alice = await make_user()
    await client.post("/api/links", json={"url": "https://example.com/ttl"}, headers=alice)

    keys = [k.decode() if isinstance(k, bytes) else k async for k in redis_client.scan_iter("rate:links:*")]
    mine = [k for k in keys if str(user_id) in k]
    assert mine, f"no rate counter written; saw {keys}"
    ttl = await redis_client.ttl(mine[0])
    assert 0 < ttl <= 60, f"counter TTL is {ttl}"


async def test_search_rate_limit_rejects_before_embedding(
    client, app_state, make_user, monkeypatch
):
    """Search embeds the query on the CPU, so the limit must fire *before* that
    work happens — otherwise the limit doesn't protect the thing it exists for."""
    from api.config import settings
    from api.routers import links as links_router

    monkeypatch.setattr(settings, "EMBEDDINGS_ENABLED", True)
    monkeypatch.setattr(settings, "SEARCH_PER_MINUTE", 2)
    monkeypatch.setattr(settings, "SEARCH_EMBED_CACHE_TTL", 0)  # force a real embed each call

    calls = []

    async def _embed(text):
        calls.append(text)
        from conftest import fake_vector

        return fake_vector(text)

    monkeypatch.setattr(links_router, "embed_text", _embed)

    _, alice = await make_user()
    codes = [(await client.get("/api/links/search?q=hello", headers=alice)).status_code for _ in range(4)]
    assert codes == [200, 200, 429, 429], codes
    assert len(calls) == 2, f"embedded {len(calls)} times for 4 requests — limit ran too late"


async def test_insights_rate_limit_fires_before_provider_resolution(
    client, app_state, make_user, monkeypatch
):
    """Over-limit callers must get 429, not the 422 'no provider configured'."""
    from api.config import settings

    monkeypatch.setattr(settings, "INSIGHTS_PER_MINUTE", 1)
    _, alice = await make_user()
    r = await client.post("/api/links", json={"url": "https://example.com/ins"}, headers=alice)
    link_id = r.json()["id"]

    first = await client.post(f"/api/links/{link_id}/insights", headers=alice)
    assert first.status_code == 422  # no AI key configured in tests
    second = await client.post(f"/api/links/{link_id}/insights", headers=alice)
    assert second.status_code == 429


async def test_auth_login_rate_limit_is_enforced(client, app_state, make_user, monkeypatch):
    """slowapi limit on /login, keyed by client IP — the credential-stuffing guard."""
    from api.config import settings

    monkeypatch.setattr(settings, "AUTH_LOGIN_RATE_LIMIT", "3/minute")
    codes = [
        (
            await client.post(
                "/api/auth/login", json={"email": "nobody@example.com", "password": "Wrongpass123"}
            )
        ).status_code
        for _ in range(5)
    ]
    assert 429 in codes, codes
    assert codes.count(401) == 3, codes


async def test_global_daily_signup_ceiling(client, app_state, monkeypatch):
    from api.config import settings

    monkeypatch.setattr(settings, "SIGNUPS_PER_DAY_GLOBAL", 2)
    codes = []
    for i in range(3):
        r = await client.post(
            "/api/auth/register", json={"email": f"u{i}@example.com", "password": "Testpass123"}
        )
        codes.append(r.status_code)
    assert codes == [201, 201, 429], codes


async def test_disposable_email_signup_is_blocked_when_enabled(client, app_state, monkeypatch):
    from api.config import settings

    monkeypatch.setattr(settings, "BLOCK_DISPOSABLE_EMAILS", True)
    r = await client.post(
        "/api/auth/register", json={"email": "throwaway@mailinator.com", "password": "Testpass123"}
    )
    assert r.status_code == 422
    assert "permanent email" in r.json()["detail"].lower()

    # A real domain still gets through.
    r = await client.post(
        "/api/auth/register", json={"email": "real@example.com", "password": "Testpass123"}
    )
    assert r.status_code == 201
