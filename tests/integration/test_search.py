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
# Filtered search — the filters must narrow the candidate set BEFORE ranking
# --------------------------------------------------------------------------- #
async def _set(link_id, **fields):
    from sqlalchemy import update

    from api.database import AsyncSessionLocal
    from api.models.link import Link

    async with AsyncSessionLocal() as db:
        await db.execute(update(Link).where(Link.id == link_id).values(**fields))
        await db.commit()


async def test_search_applies_the_tag_filter(client, app_state, make_user, stub_embeddings):
    _, alice = await make_user()
    a = await _save_and_embed(client, alice, "https://example.com/a", "async runtimes")
    b = await _save_and_embed(client, alice, "https://example.com/b", "async runtimes")
    await _set(a, ai_tags=["Rust"])
    await _set(b, ai_tags=["Zig"])

    r = await client.get(
        "/api/links/search", params={"q": "async runtimes", "tag": "rust"}, headers=alice
    )
    assert r.status_code == 200, r.text
    assert [x["canonical_url"] for x in r.json()] == ["https://example.com/a"]


async def test_search_filters_before_ranking(client, app_state, make_user, stub_embeddings):
    """The trap this guards: rank first, then drop non-matching rows from the
    page, and "top 3 matches of which 1 is tagged rust" becomes a 1-result search
    that hides the rest of the library's rust links entirely.
    """
    _, alice = await make_user()
    # Three closer matches, none tagged rust, plus one weaker match that is.
    for i in range(3):
        near = await _save_and_embed(
            client, alice, f"https://example.com/near{i}", "async runtimes"
        )
        await _set(near, ai_tags=["Zig"])
    far = await _save_and_embed(client, alice, "https://example.com/far", "sourdough baking")
    await _set(far, ai_tags=["Rust"])

    # limit=3 is smaller than the number of better-ranked non-matching rows, so a
    # filter applied after ranking would return nothing at all.
    r = await client.get(
        "/api/links/search",
        params={"q": "async runtimes", "tag": "rust", "limit": 3},
        headers=alice,
    )
    assert [x["canonical_url"] for x in r.json()] == ["https://example.com/far"]


async def test_search_applies_content_type_and_domain_filters(
    client, app_state, make_user, stub_embeddings
):
    _, alice = await make_user()
    a = await _save_and_embed(client, alice, "https://github.com/x/y", "build tooling")
    b = await _save_and_embed(client, alice, "https://example.com/z", "build tooling")
    await _set(a, content_type="tool")
    await _set(b, content_type="article")

    r = await client.get(
        "/api/links/search", params={"q": "build tooling", "domain": "github.com"},
        headers=alice,
    )
    assert [x["canonical_url"] for x in r.json()] == ["https://github.com/x/y"]

    r = await client.get(
        "/api/links/search", params={"q": "build tooling", "content_type": "article"},
        headers=alice,
    )
    assert [x["canonical_url"] for x in r.json()] == ["https://example.com/z"]


async def test_search_filters_and_together(client, app_state, make_user, stub_embeddings):
    _, alice = await make_user()
    hit = await _save_and_embed(client, alice, "https://github.com/hit", "vector search")
    await _set(hit, ai_tags=["Vector Search"], content_type="tool")
    # Same tag, same domain, same text — only content_type differs, so this row
    # is only excluded if every filter is ANDed rather than the last one winning.
    await _set(
        await _save_and_embed(client, alice, "https://github.com/miss", "vector search"),
        ai_tags=["Vector Search"],
        content_type="article",
    )

    r = await client.get(
        "/api/links/search",
        params={
            "q": "vector search",
            "tag": "vector-search",
            "domain": "github.com",
            "content_type": "tool",
        },
        headers=alice,
    )
    assert [x["canonical_url"] for x in r.json()] == ["https://github.com/hit"]


async def test_search_with_an_unmatchable_filter_returns_empty_not_everything(
    client, app_state, make_user, stub_embeddings
):
    """A tag that normalises to empty, or a malformed domain, must not silently
    drop the filter — that would look like a wildly wrong match set."""
    _, alice = await make_user()
    await _save_and_embed(client, alice, "https://example.com/a", "async runtimes")

    for params in (
        {"q": "async runtimes", "tag": "___"},
        {"q": "async runtimes", "domain": "not a host"},
    ):
        r = await client.get("/api/links/search", params=params, headers=alice)
        assert r.status_code == 200, r.text
        assert r.json() == [], params


async def test_filtered_search_stays_user_scoped(
    client, app_state, make_user, stub_embeddings
):
    _, alice = await make_user("alice@example.com")
    _, bob = await make_user("bob@example.com")
    a = await _save_and_embed(client, alice, "https://example.com/alice", "async runtimes")
    await _set(a, ai_tags=["Rust"])

    r = await client.get(
        "/api/links/search", params={"q": "async runtimes", "tag": "rust"}, headers=bob
    )
    assert r.json() == []


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


async def test_search_combines_several_tags_under_either_logic(
    client, app_state, make_user, stub_embeddings
):
    """Search and browse share one filter helper, so the Any/All switch has to
    mean the same thing with a query in the box as without one."""
    _, alice = await make_user()
    rust = await _save_and_embed(client, alice, "https://example.com/rust", "async runtimes")
    llm = await _save_and_embed(client, alice, "https://example.com/llm", "async runtimes")
    both = await _save_and_embed(client, alice, "https://example.com/both", "async runtimes")
    await _set(rust, ai_tags=["Rust"])
    await _set(llm, ai_tags=["LLM"])
    await _set(both, ai_tags=["rust", "llm"])

    async def _urls(**params):
        r = await client.get(
            "/api/links/search",
            params={"q": "async runtimes", "limit": 100, **params},
            headers=alice,
        )
        assert r.status_code == 200, r.text
        return sorted(x["canonical_url"] for x in r.json())

    assert await _urls(tag=["rust", "llm"], tag_logic="any") == [
        "https://example.com/both",
        "https://example.com/llm",
        "https://example.com/rust",
    ]
    assert await _urls(tag=["rust", "llm"], tag_logic="all") == [
        "https://example.com/both"
    ]
