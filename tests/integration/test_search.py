"""Semantic search + related-links — pgvector queries, user-scoped.

`embed_text` is stubbed with a deterministic hash-derived vector so ordering is
stable and no ONNX model is loaded; the pgvector cosine ordering itself is real.
"""
import pytest

pytestmark = pytest.mark.integration


@pytest.fixture
def stub_embeddings(monkeypatch):
    """Enable embeddings with a deterministic fake model."""
    from conftest import fake_vector

    from api.config import settings
    from api.routers import links as links_router
    from worker import embed as embed_job

    monkeypatch.setattr(settings, "EMBEDDINGS_ENABLED", True)
    monkeypatch.setattr(settings, "SEARCH_EMBED_CACHE_TTL", 0)

    async def _embed(text):
        return fake_vector(text)

    monkeypatch.setattr(links_router, "embed_text", _embed)
    monkeypatch.setattr(embed_job, "embed_text", _embed)
    return _embed


async def _save_and_embed(client, headers, url, title):
    """Create a link, force a known title, then run the embed job on it."""
    from sqlalchemy import update

    from api.database import AsyncSessionLocal
    from api.models.link import Link
    from worker import embed as embed_job

    r = await client.post("/api/links", json={"url": url}, headers=headers)
    assert r.status_code == 201, r.text
    link_id = r.json()["id"]

    async with AsyncSessionLocal() as db:
        await db.execute(update(Link).where(Link.id == link_id).values(title=title))
        await db.commit()
    await embed_job.embed_link({}, link_id)
    return link_id


async def test_search_returns_503_when_embeddings_are_disabled(
    client, app_state, make_user, monkeypatch
):
    """The SPA relies on 503 to fall back to client-side substring filtering."""
    from api.config import settings

    monkeypatch.setattr(settings, "EMBEDDINGS_ENABLED", False)
    _, alice = await make_user()
    r = await client.get("/api/links/search?q=anything", headers=alice)
    assert r.status_code == 503
    assert "disabled" in r.json()["detail"].lower()


async def test_search_requires_a_query(client, app_state, make_user, stub_embeddings):
    _, alice = await make_user()
    assert (await client.get("/api/links/search?q=", headers=alice)).status_code == 422
    assert (await client.get("/api/links/search", headers=alice)).status_code == 422


async def test_search_is_user_scoped(client, app_state, make_user, stub_embeddings):
    _, alice = await make_user("alice@example.com")
    _, bob = await make_user("bob@example.com")

    await _save_and_embed(client, alice, "https://example.com/alice", "rust async runtimes")
    await _save_and_embed(client, bob, "https://example.com/bob", "rust async runtimes")

    a = (await client.get("/api/links/search?q=rust", headers=alice)).json()
    assert len(a) == 1
    assert a[0]["canonical_url"] == "https://example.com/alice"

    b = (await client.get("/api/links/search?q=rust", headers=bob)).json()
    assert len(b) == 1
    assert b[0]["canonical_url"] == "https://example.com/bob"


async def test_search_skips_links_without_a_vector(client, app_state, make_user, stub_embeddings):
    _, alice = await make_user()
    await _save_and_embed(client, alice, "https://example.com/embedded", "graph databases")
    # Saved but never embedded (the fake pool doesn't run jobs).
    await client.post("/api/links", json={"url": "https://example.com/raw"}, headers=alice)

    urls = {x["canonical_url"] for x in (await client.get("/api/links/search?q=graph", headers=alice)).json()}
    assert urls == {"https://example.com/embedded"}


async def test_search_orders_by_similarity(client, app_state, make_user, stub_embeddings):
    """The closest vector must come first — this exercises the real pgvector
    `cosine_distance` ordering, not just that rows come back."""
    _, alice = await make_user()
    await _save_and_embed(client, alice, "https://example.com/a", "kubernetes operators")
    await _save_and_embed(client, alice, "https://example.com/b", "sourdough baking")

    results = (
        await client.get("/api/links/search?q=kubernetes operators", headers=alice)
    ).json()
    assert results[0]["canonical_url"] == "https://example.com/a", (
        "exact-text match did not rank first"
    )


async def test_search_honours_the_limit(client, app_state, make_user, stub_embeddings):
    _, alice = await make_user()
    for i in range(4):
        await _save_and_embed(client, alice, f"https://example.com/l{i}", f"topic {i}")
    r = await client.get("/api/links/search?q=topic&limit=2", headers=alice)
    assert len(r.json()) == 2


async def test_query_vector_is_cached_in_redis(client, app_state, make_user, monkeypatch):
    """The cache is an optimisation — a second identical query must not re-embed."""
    from conftest import fake_vector

    from api.config import settings
    from api.routers import links as links_router

    monkeypatch.setattr(settings, "EMBEDDINGS_ENABLED", True)
    monkeypatch.setattr(settings, "SEARCH_EMBED_CACHE_TTL", 60)

    calls = []

    async def _embed(text):
        calls.append(text)
        return fake_vector(text)

    monkeypatch.setattr(links_router, "embed_text", _embed)

    _, alice = await make_user()
    for _ in range(3):
        assert (await client.get("/api/links/search?q=same+query", headers=alice)).status_code == 200
    assert len(calls) == 1, f"query embedded {len(calls)} times despite the cache"


# --------------------------------------------------------------------------- #
# Related links
# --------------------------------------------------------------------------- #
async def test_similar_excludes_the_source_and_scopes_to_the_user(
    client, app_state, make_user, stub_embeddings
):
    _, alice = await make_user("alice@example.com")
    _, bob = await make_user("bob@example.com")

    source = await _save_and_embed(client, alice, "https://example.com/src", "distributed tracing")
    await _save_and_embed(client, alice, "https://example.com/near", "distributed tracing tools")
    await _save_and_embed(client, bob, "https://example.com/bobs", "distributed tracing")

    results = (await client.get(f"/api/links/{source}/similar", headers=alice)).json()
    ids = {x["id"] for x in results}
    assert source not in ids, "a link was returned as similar to itself"
    assert {x["canonical_url"] for x in results} == {"https://example.com/near"}


async def test_similar_returns_empty_rather_than_erroring_without_a_vector(
    client, app_state, make_user, stub_embeddings
):
    """The drawer hides the panel on an empty list; an error would surface a
    spurious failure for a link whose embed job hasn't run yet."""
    _, alice = await make_user()
    r = await client.post("/api/links", json={"url": "https://example.com/fresh"}, headers=alice)
    link_id = r.json()["id"]
    r = await client.get(f"/api/links/{link_id}/similar", headers=alice)
    assert r.status_code == 200
    assert r.json() == []


async def test_similar_returns_empty_when_embeddings_are_disabled(
    client, app_state, make_user, stub_embeddings, monkeypatch
):
    from api.config import settings

    _, alice = await make_user()
    source = await _save_and_embed(client, alice, "https://example.com/s", "topic")
    monkeypatch.setattr(settings, "EMBEDDINGS_ENABLED", False)
    r = await client.get(f"/api/links/{source}/similar", headers=alice)
    assert r.status_code == 200
    assert r.json() == []


async def test_similar_excludes_archived_links(client, app_state, make_user, stub_embeddings):
    _, alice = await make_user()
    source = await _save_and_embed(client, alice, "https://example.com/src2", "vector databases")
    other = await _save_and_embed(client, alice, "https://example.com/done", "vector databases too")

    await client.patch(f"/api/links/{other}", json={"status": "done"}, headers=alice)
    assert (await client.get(f"/api/links/{source}/similar", headers=alice)).json() == []
