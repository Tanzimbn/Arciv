"""The SSRF guard on the paths that need a real database.

`tests/test_ssrf_guard.py` covers the policy itself. These two cases exist
because their code paths swallow every exception and write to the DB instead of
returning anything — the only observable proof that the guard fired is what the
rows and the request log say afterwards.
"""
import uuid

import httpx
import pytest
from sqlalchemy import select

from api.config import settings
from api.models.feed import Feed, FeedItem
from api.utils import safe_fetch
from worker.feed_poll import poll_single_feed

pytestmark = pytest.mark.integration


@pytest.fixture
def blocked_dns(monkeypatch):
    """Every hostname resolves into the Compose network."""

    async def resolve(host):
        return ["172.20.0.2"]

    monkeypatch.setattr(safe_fetch, "_resolve", resolve)


async def test_feed_poll_fails_a_feed_that_now_points_inward(
    app_state, make_user, session_factory, blocked_dns, no_network
):
    """A feed URL that was public at subscribe time can start resolving private.

    The cron polls unattended, so this is the one fetcher with no user watching
    it — and ``no_network`` turns a leaked request into a failure rather than a
    real connection to Postgres' port.
    """
    user_id, _ = await make_user()

    async with session_factory() as db:
        feed = Feed(
            user_id=user_id,
            feed_url="http://rebound.test/rss",
            site_url="http://rebound.test/",
            title="Rebound",
            status="active",
        )
        db.add(feed)
        await db.commit()
        feed_id = feed.id

    await poll_single_feed({}, str(feed_id))

    async with session_factory() as db:
        polled = await db.get(Feed, feed_id)
        # Treated as a failing feed: nothing fetched, nothing recorded, and the
        # existing consecutive-failure escalation takes it from here.
        assert polled.consecutive_failures == 1
        assert polled.last_etag is None
        assert polled.total_items_received == 0


async def test_link_create_rejects_an_internal_url_with_400(
    client, app_state, make_user, blocked_dns, monkeypatch
):
    """POST /api/links must answer 400, not 500 and not 201.

    ``app_state`` stubs the fetchers, so this test restores the real
    ``canonicalize_url`` to exercise the guard rather than the stub.
    """
    from api.routers import links as links_router
    from api.utils.metadata import canonicalize_url

    monkeypatch.setattr(links_router, "canonicalize_url", canonicalize_url)
    _user_id, alice = await make_user()

    r = await client.post(
        "/api/links", json={"url": "http://internal-service/admin"}, headers=alice
    )

    assert r.status_code == 400, r.text
    assert "private/internal" in r.json()["detail"]

    listed = await client.get("/api/links", headers=alice)
    assert listed.json() == [], "the link was saved despite being rejected"


async def test_feeds_discover_is_rate_limited(
    client, app_state, make_user, monkeypatch
):
    """Discovery makes up to seven outbound requests per call and had no limit.

    The limiter must run before any of them, so the over-limit call is a 429 even
    though ``discover_feed`` here would otherwise try to fetch.
    """
    monkeypatch.setattr(settings, "FEEDS_DISCOVER_PER_MINUTE", 2)

    async def never_finds_anything(url):
        return None

    from api.routers import feeds as feeds_router

    monkeypatch.setattr(feeds_router, "discover_feed", never_finds_anything)
    _user_id, alice = await make_user()

    body = {"url": "https://example.com/blog"}
    codes = [
        (await client.post("/api/feeds/discover", json=body, headers=alice)).status_code
        for _ in range(3)
    ]

    assert codes == [422, 422, 429], codes  # 422 = "no feed found", limit intact


async def test_feeds_discover_requires_auth(client, app_state):
    """It used to be unauthenticated — an open fetch proxy for anyone on the
    internet, with no per-user counter possible."""
    r = await client.post(
        "/api/feeds/discover", json={"url": "https://example.com/blog"}
    )
    assert r.status_code in (401, 403), r.text


async def test_subscribe_does_not_fetch_an_internal_feed_url(
    client, app_state, make_user, blocked_dns, no_network, session_factory
):
    """``_seed_feed_history`` fetched the URL unguarded on every subscribe.

    Seeding is best-effort by design, so the subscribe still succeeds; what must
    not happen is the request going out.
    """
    _user_id, alice = await make_user()

    r = await client.post(
        "/api/feeds",
        json={
            "feed_url": "http://internal-service/rss",
            "site_url": "http://internal-service/",
            "title": "Internal",
        },
        headers=alice,
    )

    assert r.status_code == 201, r.text
    feed_id = uuid.UUID(r.json()["id"])

    async with session_factory() as db:
        feed = await db.get(Feed, feed_id)
        assert feed.last_etag is None, "history was seeded, so the fetch went out"


async def test_public_feed_url_still_seeds_history(
    client, app_state, make_user, monkeypatch, session_factory
):
    """The counterpart: guarding must not break ordinary subscribes.

    The suite never touches the network, so this is the closest available proof
    that a normal feed still fetches, parses and seeds through the pinned path.
    """
    RSS = (
        '<?xml version="1.0"?><rss version="2.0"><channel><title>Blog</title>'
        "<item><title>One</title><link>https://blog.test/1</link>"
        "<guid>https://blog.test/1</guid></item></channel></rss>"
    )

    async def resolve(host):
        return ["93.184.216.34"]

    async def handle(transport_self, request):
        assert request.url.host == "93.184.216.34", "connection was not pinned"
        assert request.headers["Host"] == "blog.test", "Host header lost the hostname"
        return httpx.Response(200, text=RSS, headers={"ETag": '"abc123"'})

    monkeypatch.setattr(safe_fetch, "_resolve", resolve)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", handle)
    _user_id, alice = await make_user()

    r = await client.post(
        "/api/feeds",
        json={
            "feed_url": "http://blog.test/rss",
            "site_url": "http://blog.test/",
            "title": "Blog",
        },
        headers=alice,
    )
    assert r.status_code == 201, r.text

    async with session_factory() as db:
        feed = await db.get(Feed, uuid.UUID(r.json()["id"]))
        assert feed.last_etag == '"abc123"'
        guids = (
            await db.execute(select(FeedItem.guid).where(FeedItem.feed_id == feed.id))
        ).scalars().all()
        assert guids == ["https://blog.test/1"]
