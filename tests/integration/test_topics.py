"""Topic explorer + link filters — the read-time tag grouping.

The feature rests on one invariant: a topic's ``count`` must equal the number of
links ``GET /api/links?tag=<key>`` returns. The count is produced by SQL
(``tag_key_sql``) grouping unnested tags; the filter is resolved by the same SQL
against a key normalised in Python (``normalise_tag``). If those two ever drift,
clicking a topic that says 7 shows 4, so the pairing is asserted here against a
real Postgres rather than mocked.
"""
import pytest

pytestmark = pytest.mark.integration


async def _link(client, headers, url, **fields):
    """Create a link, then force AI/user fields the pipeline would have set."""
    from sqlalchemy import update

    from api.database import AsyncSessionLocal
    from api.models.link import Link

    r = await client.post("/api/links", json={"url": url}, headers=headers)
    assert r.status_code == 201, r.text
    link_id = r.json()["id"]
    if fields:
        async with AsyncSessionLocal() as db:
            await db.execute(update(Link).where(Link.id == link_id).values(**fields))
            await db.commit()
    return link_id


async def _topics(client, headers, **params):
    r = await client.get("/api/topics", params=params, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


# --------------------------------------------------------------------------- #
# Tenancy — CLAUDE.md: every query filters on user_id
# --------------------------------------------------------------------------- #
async def test_topics_never_leak_across_users(client, app_state, make_user):
    _, alice = await make_user("alice@example.com")
    _, bob = await make_user("bob@example.com")

    await _link(client, alice, "https://example.com/a1", ai_tags=["rust", "wasm"])
    await _link(client, alice, "https://example.com/a2", ai_tags=["rust"])
    await _link(client, bob, "https://example.com/b1", ai_tags=["elixir"])
    await _link(client, bob, "https://example.com/b2", ai_tags=["elixir"])

    assert [t["key"] for t in await _topics(client, alice, min_count=1)] == ["rust", "wasm"]
    assert [t["key"] for t in await _topics(client, bob, min_count=1)] == ["elixir"]


async def test_tag_filter_never_leaks_across_users(client, app_state, make_user):
    _, alice = await make_user("alice@example.com")
    _, bob = await make_user("bob@example.com")
    await _link(client, alice, "https://example.com/a1", ai_tags=["rust"])

    r = await client.get("/api/links?tag=rust", headers=bob)
    assert r.status_code == 200
    assert r.json() == []


# --------------------------------------------------------------------------- #
# Grouping
# --------------------------------------------------------------------------- #
async def test_spellings_of_one_topic_collapse_into_one_row(client, app_state, make_user):
    """The reason the feature normalises at all."""
    _, alice = await make_user()
    for i, tag in enumerate(["PostgreSQL", "postgresql", "  Postgresql ", "postgre_sql"]):
        await _link(client, alice, f"https://example.com/{i}", ai_tags=[tag])

    topics = await _topics(client, alice, min_count=1)
    keys = {t["key"] for t in topics}
    assert "postgresql" in keys
    by_key = {t["key"]: t for t in topics}
    assert by_key["postgresql"]["count"] == 3
    # "postgre_sql" is a genuinely different word run, so it stays separate —
    # normalisation folds spelling, it does not guess synonyms.
    assert by_key["postgre-sql"]["count"] == 1


async def test_label_is_the_dominant_spelling(client, app_state, make_user):
    _, alice = await make_user()
    for i in range(3):
        await _link(client, alice, f"https://example.com/{i}", ai_tags=["PostgreSQL"])
    await _link(client, alice, "https://example.com/odd", ai_tags=["postgresql"])

    topics = await _topics(client, alice, min_count=1)
    assert [t["label"] for t in topics if t["key"] == "postgresql"] == ["PostgreSQL"]


async def test_two_spellings_on_one_link_count_once(client, app_state, make_user):
    """count(DISTINCT link) — not a count of unnested tag rows."""
    _, alice = await make_user()
    await _link(client, alice, "https://example.com/1", ai_tags=["Rust", "rust", "RUST"])

    topics = await _topics(client, alice, min_count=1)
    assert [(t["key"], t["count"]) for t in topics] == [("rust", 1)]


async def test_separator_only_tags_are_dropped(client, app_state, make_user):
    _, alice = await make_user()
    await _link(client, alice, "https://example.com/1", ai_tags=["___", "  ", "-", "rust"])

    assert [t["key"] for t in await _topics(client, alice, min_count=1)] == ["rust"]
    # And the filter refuses to treat an empty key as "no filter", which would
    # hand back the whole library.
    r = await client.get("/api/links?tag=___", headers=alice)
    assert r.status_code == 200
    assert r.json() == []


async def test_untagged_links_do_not_appear(client, app_state, make_user):
    _, alice = await make_user()
    await _link(client, alice, "https://example.com/untagged")
    await _link(client, alice, "https://example.com/empty", ai_tags=[])
    assert await _topics(client, alice, min_count=1) == []


# --------------------------------------------------------------------------- #
# Parameters
# --------------------------------------------------------------------------- #
async def test_min_count_filters_the_singleton_tail(client, app_state, make_user):
    _, alice = await make_user()
    await _link(client, alice, "https://example.com/1", ai_tags=["rust", "obscure"])
    await _link(client, alice, "https://example.com/2", ai_tags=["rust"])

    assert [t["key"] for t in await _topics(client, alice)] == ["rust"]  # default 2
    assert {t["key"] for t in await _topics(client, alice, min_count=1)} == {
        "rust",
        "obscure",
    }


async def test_ordering_is_by_count_then_key(client, app_state, make_user):
    _, alice = await make_user()
    await _link(client, alice, "https://example.com/1", ai_tags=["rust", "zig", "ada"])
    await _link(client, alice, "https://example.com/2", ai_tags=["rust", "zig"])
    await _link(client, alice, "https://example.com/3", ai_tags=["rust"])

    assert [t["key"] for t in await _topics(client, alice, min_count=1)] == [
        "rust",  # 3
        "zig",   # 2
        "ada",   # 1
    ]


async def test_limit_caps_the_list(client, app_state, make_user):
    _, alice = await make_user()
    await _link(client, alice, "https://example.com/1", ai_tags=["a", "b", "c"])
    assert len(await _topics(client, alice, min_count=1, limit=2)) == 2


async def test_archived_links_are_excluded_unless_the_archive_tab_asks(
    client, app_state, make_user
):
    """Counts must describe the set the link list will show after a click."""
    _, alice = await make_user()
    await _link(client, alice, "https://example.com/1", ai_tags=["rust"])
    await _link(client, alice, "https://example.com/2", ai_tags=["rust"], status="done")

    assert [t["count"] for t in await _topics(client, alice, min_count=1)] == [1]
    assert [
        t["count"] for t in await _topics(client, alice, min_count=1, queue="archive")
    ] == [1]


# --------------------------------------------------------------------------- #
# Queue scoping — the rail describes the active tab, not the library
# --------------------------------------------------------------------------- #
async def test_topics_are_scoped_to_the_requested_queue(client, app_state, make_user):
    """On Try Later the rail must show Try Later's topics with Try Later's counts.
    Scoped by the same helper the link list uses, so the two cannot disagree."""
    _, alice = await make_user()
    await _link(client, alice, "https://example.com/t1", ai_tags=["rust"], queue="try-later")
    await _link(client, alice, "https://example.com/t2", ai_tags=["rust"], queue="try-later")
    await _link(client, alice, "https://example.com/r1", ai_tags=["rust"], queue="read-later")
    await _link(client, alice, "https://example.com/r2", ai_tags=["prose"], queue="read-later")

    assert [(t["key"], t["count"]) for t in await _topics(client, alice, min_count=1)] == [
        ("rust", 3),
        ("prose", 1),
    ]
    assert [
        (t["key"], t["count"])
        for t in await _topics(client, alice, min_count=1, queue="try-later")
    ] == [("rust", 2)]
    # A topic with no links in this tab drops off the rail rather than offering a
    # click that returns nothing.
    assert [
        t["key"] for t in await _topics(client, alice, min_count=1, queue="watch-later")
    ] == []


async def test_a_queue_scoped_count_matches_the_queue_scoped_link_list(
    client, app_state, make_user
):
    """The end-to-end invariant, per tab: chip count == what the tab then shows."""
    _, alice = await make_user()
    plan = [
        ("try-later", ["Rust", "CLI Tools"], "active"),
        ("try-later", ["rust"], "active"),
        ("try-later", ["Rust"], "done"),          # archived — out of the tab
        ("read-later", ["Rust", "prose"], "active"),
        ("watch-later", ["rust"], "active"),
    ]
    for i, (queue, tags, status) in enumerate(plan):
        await _link(
            client, alice, f"https://example.com/{i}",
            ai_tags=tags, queue=queue, status=status,
        )

    for queue in (None, "try-later", "read-later", "watch-later", "inbox", "archive"):
        params = {"min_count": 1}
        if queue:
            params["queue"] = queue
        for topic in await _topics(client, alice, **params):
            r = await client.get(
                "/api/links",
                params={"tag": topic["key"], "limit": 1000, **({"queue": queue} if queue else {})},
                headers=alice,
            )
            assert r.status_code == 200, r.text
            assert len(r.json()) == topic["count"], (queue, topic)


async def test_archive_topics_span_every_queue(client, app_state, make_user):
    """"archive" is a status, not a queue — the tab shows done links from all of
    them, so its topics have to as well."""
    _, alice = await make_user()
    await _link(
        client, alice, "https://example.com/1",
        ai_tags=["rust"], queue="try-later", status="done",
    )
    await _link(
        client, alice, "https://example.com/2",
        ai_tags=["rust"], queue="read-later", status="done",
    )
    assert [
        (t["key"], t["count"])
        for t in await _topics(client, alice, min_count=1, queue="archive")
    ] == [("rust", 2)]


async def test_an_unknown_queue_yields_no_topics(client, app_state, make_user):
    """Not an error: the link list treats an unknown queue the same way, and an
    empty rail is honest about there being nothing to show."""
    _, alice = await make_user()
    await _link(client, alice, "https://example.com/1", ai_tags=["rust"])
    assert await _topics(client, alice, min_count=1, queue="nonsense") == []


async def test_topics_require_auth(client, app_state):
    assert (await client.get("/api/topics")).status_code in (401, 403)


# --------------------------------------------------------------------------- #
# The invariant: count == len(links?tag=key)
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "tags",
    [
        ["PostgreSQL", "postgres_db", "Vector Search"],
        ["react native", "React_Native", "ci/cd"],
        ["  spaced  out  ", "Node.js", "C++"],
        ["Café Culture", "日本語 タグ"],
        # Literal tab and newline inside a tag: this is what proves Postgres'
        # regex engine reads the \t / \n escapes in _SEPARATORS_SQL the same way
        # Python's does. If it does not, switch the pattern to [[:space:]_]+.
        ["tab\there", "new\nline", "carriage\rreturn"],
        # Non-breaking / em spaces: the count and the filter have to key these
        # identically even though neither side folds them to a hyphen.
        ["\xa0Rust\xa0", "em\u2003space", "plain rust"],
    ],
)
async def test_every_topic_count_matches_its_filtered_link_list(
    client, app_state, make_user, tags
):
    _, alice = await make_user()
    # Spread the tags over several links with overlap, so counts differ per topic.
    for i in range(4):
        await _link(
            client, alice, f"https://example.com/{i}", ai_tags=tags[: (i % len(tags)) + 1]
        )

    topics = await _topics(client, alice, min_count=1)
    assert topics, "fixture produced no topics"
    for topic in topics:
        # params=, not an f-string: a key like "c++" has to be percent-encoded
        # or the "+" arrives as a space. URLSearchParams does this in the SPA.
        r = await client.get(
            "/api/links", params={"tag": topic["key"], "limit": 1000}, headers=alice
        )
        assert r.status_code == 200, r.text
        assert len(r.json()) == topic["count"], topic


async def test_python_and_sql_normalisers_agree_in_postgres(app_state):
    """Direct comparison, independent of the routes that use them."""
    from sqlalchemy import literal, select

    from api.database import AsyncSessionLocal
    from api.utils.tags import normalise_tag, tag_key_sql

    samples = [
        "PostgreSQL", "postgres_db", "  React Native  ", "react__native",
        "tab\there", "new\nline", "form\ffeed", "vert\vtab", "carriage\rreturn",
        "-- ci/cd --", "Node.js", "C++", "Café Culture", "日本語 タグ",
        "___", "   ", "-", "a \t\n_ b",
        # Unicode spaces at the edges. Python's str.strip() removed these while
        # btrim() left them, so the key differed between the count and the
        # filter; neither side trims now.
        "\xa0Rust\xa0", "\u2003Rust", "a\xa0b", "\xa0", "\u3000 mixed \xa0",
    ]
    async with AsyncSessionLocal() as db:
        for raw in samples:
            got = await db.scalar(select(tag_key_sql(literal(raw))))
            assert got == normalise_tag(raw), f"{raw!r}: sql={got!r}"


async def test_a_topic_key_round_trips_through_the_filter(client, app_state, make_user):
    """normalise_tag(key) == key, checked against what the API actually emits."""
    from api.utils.tags import normalise_tag

    _, alice = await make_user()
    await _link(
        client, alice, "https://example.com/1",
        ai_tags=["PostgreSQL", "React_Native", "  Vector  Search  "],
    )
    for topic in await _topics(client, alice, min_count=1):
        assert normalise_tag(topic["key"]) == topic["key"]


# --------------------------------------------------------------------------- #
# The other filters on GET /api/links
# --------------------------------------------------------------------------- #
async def test_content_type_filter(client, app_state, make_user):
    _, alice = await make_user()
    await _link(client, alice, "https://example.com/vid", content_type="video")
    await _link(client, alice, "https://example.com/art", content_type="article")

    r = await client.get("/api/links?content_type=video", headers=alice)
    assert [x["canonical_url"] for x in r.json()] == ["https://example.com/vid"]


async def test_content_type_filter_accepts_a_value_patch_would_reject(
    client, app_state, make_user
):
    """`agent/prompt.CONTENT_TYPES` has "documentation"; the PATCH allowlist does
    not. The AI can store it, so the filter must be able to find it — validating
    against the schema's list here would make a real stored value unfilterable.
    """
    _, alice = await make_user()
    await _link(client, alice, "https://example.com/docs", content_type="documentation")
    r = await client.get("/api/links?content_type=documentation", headers=alice)
    assert len(r.json()) == 1


async def test_domain_filter_matches_host_and_www_but_not_lookalikes(
    client, app_state, make_user
):
    _, alice = await make_user()
    await _link(client, alice, "https://github.com/a/b")
    await _link(client, alice, "https://www.github.com/c/d")
    await _link(client, alice, "https://notgithub.com/e")
    # The dots in the host must be escaped, or this would match too.
    await _link(client, alice, "https://githubxcom.example/f")

    for probe in ("github.com", "GitHub.com", "www.github.com"):
        r = await client.get("/api/links", params={"domain": probe}, headers=alice)
        assert r.status_code == 200, r.text
        hosts = sorted(x["canonical_url"] for x in r.json())
        assert hosts == ["https://github.com/a/b", "https://www.github.com/c/d"], probe


async def test_a_malformed_domain_matches_nothing_rather_than_everything(
    client, app_state, make_user
):
    _, alice = await make_user()
    await _link(client, alice, "https://example.com/1")
    for bad in ("not a host", "exa mple.com", "%%%"):
        r = await client.get("/api/links", params={"domain": bad}, headers=alice)
        assert r.status_code == 200, r.text
        assert r.json() == [], bad


async def test_date_range_filter(client, app_state, make_user):
    from datetime import datetime, timedelta, timezone

    _, alice = await make_user()
    now = datetime.now(timezone.utc)
    await _link(client, alice, "https://example.com/old", saved_at=now - timedelta(days=40))
    await _link(client, alice, "https://example.com/new", saved_at=now - timedelta(days=1))

    since = (now - timedelta(days=7)).isoformat()
    r = await client.get("/api/links", params={"since": since}, headers=alice)
    assert [x["canonical_url"] for x in r.json()] == ["https://example.com/new"]

    until = (now - timedelta(days=20)).isoformat()
    r = await client.get("/api/links", params={"until": until}, headers=alice)
    assert [x["canonical_url"] for x in r.json()] == ["https://example.com/old"]


async def test_filters_and_together(client, app_state, make_user):
    _, alice = await make_user()
    await _link(
        client, alice, "https://github.com/match",
        ai_tags=["Rust"], content_type="tool",
    )
    await _link(
        client, alice, "https://github.com/wrong-tag",
        ai_tags=["Zig"], content_type="tool",
    )
    await _link(
        client, alice, "https://example.com/wrong-domain",
        ai_tags=["Rust"], content_type="tool",
    )

    r = await client.get(
        "/api/links?tag=rust&domain=github.com&content_type=tool", headers=alice
    )
    assert [x["canonical_url"] for x in r.json()] == ["https://github.com/match"]


async def test_tag_filter_respects_the_queue_and_status_scope(client, app_state, make_user):
    _, alice = await make_user()
    await _link(client, alice, "https://example.com/1", ai_tags=["rust"], queue="read-later")
    await _link(client, alice, "https://example.com/2", ai_tags=["rust"], queue="watch-later")
    await _link(client, alice, "https://example.com/3", ai_tags=["rust"], status="done")

    r = await client.get("/api/links?tag=rust&queue=read-later", headers=alice)
    assert [x["canonical_url"] for x in r.json()] == ["https://example.com/1"]
    # No queue: active only, so the archived one stays out.
    r = await client.get("/api/links?tag=rust", headers=alice)
    assert len(r.json()) == 2


# --------------------------------------------------------------------------- #
# Multi-topic filtering — ?tag=a&tag=b with tag_logic=any|all
# --------------------------------------------------------------------------- #
async def _titles(client, headers, **params):
    r = await client.get("/api/links", params={"limit": 1000, **params}, headers=headers)
    assert r.status_code == 200, r.text
    return sorted(link["url"].rsplit("/", 1)[-1] for link in r.json())


async def _seed_tag_matrix(client, headers):
    """rust-only, llm-only, both, neither."""
    await _link(client, headers, "https://example.com/rust", ai_tags=["Rust"])
    await _link(client, headers, "https://example.com/llm", ai_tags=["LLM"])
    await _link(client, headers, "https://example.com/both", ai_tags=["rust", "llm"])
    await _link(client, headers, "https://example.com/neither", ai_tags=["prose"])


async def test_two_tags_any_is_a_union(client, app_state, make_user):
    _, alice = await make_user()
    await _seed_tag_matrix(client, alice)
    got = await _titles(client, alice, tag=["rust", "llm"], tag_logic="any")
    assert got == ["both", "llm", "rust"]


async def test_two_tags_all_is_an_intersection(client, app_state, make_user):
    """Not a subset relationship either way round — which is why the UI asks."""
    _, alice = await make_user()
    await _seed_tag_matrix(client, alice)
    got = await _titles(client, alice, tag=["rust", "llm"], tag_logic="all")
    assert got == ["both"]


async def test_tag_logic_defaults_to_any(client, app_state, make_user):
    _, alice = await make_user()
    await _seed_tag_matrix(client, alice)
    assert await _titles(client, alice, tag=["rust", "llm"]) == ["both", "llm", "rust"]


async def test_one_tag_behaves_the_same_under_either_logic(client, app_state, make_user):
    """The old single-tag contract, unchanged — chips start from one selection."""
    _, alice = await make_user()
    await _seed_tag_matrix(client, alice)
    assert await _titles(client, alice, tag=["rust"], tag_logic="any") == ["both", "rust"]
    assert await _titles(client, alice, tag=["rust"], tag_logic="all") == ["both", "rust"]


async def test_repeated_spellings_of_one_key_are_not_an_intersection_of_two(
    client, app_state, make_user
):
    """?tag=Rust&tag=rust normalises to a single key. Under "all" a naive
    implementation would AND a key against itself — harmless — but a
    de-duplicated list keeps the EXISTS count honest and the cap meaningful."""
    _, alice = await make_user()
    await _seed_tag_matrix(client, alice)
    assert await _titles(client, alice, tag=["Rust", "rust"], tag_logic="all") == [
        "both",
        "rust",
    ]


async def test_an_unusable_key_empties_the_result_under_either_logic(
    client, app_state, make_user
):
    """A tag that normalises to "" cannot match. Dropping it would answer a
    different question — and under "any" the extra rows would read as matches."""
    _, alice = await make_user()
    await _seed_tag_matrix(client, alice)
    for logic in ("any", "all"):
        assert await _titles(client, alice, tag=["rust", "__"], tag_logic=logic) == []


async def test_multi_tag_filtering_stays_inside_the_queue_scope(
    client, app_state, make_user
):
    _, alice = await make_user()
    await _link(
        client, alice, "https://example.com/t", ai_tags=["rust"], queue="try-later"
    )
    await _link(
        client, alice, "https://example.com/r", ai_tags=["llm"], queue="read-later"
    )
    got = await _titles(client, alice, tag=["rust", "llm"], tag_logic="any", queue="try-later")
    assert got == ["t"]


async def test_multi_tag_filtering_never_crosses_users(client, app_state, make_user):
    _, alice = await make_user("alice@example.com")
    _, bob = await make_user("bob@example.com")
    await _seed_tag_matrix(client, alice)
    assert await _titles(client, bob, tag=["rust", "llm"], tag_logic="any") == []


async def test_too_many_tags_is_rejected_not_silently_truncated(
    client, app_state, make_user
):
    """Each key is its own EXISTS subquery, so the count is capped at 10."""
    _, alice = await make_user()
    r = await client.get(
        "/api/links",
        params={"tag": [f"t{i}" for i in range(11)]},
        headers=alice,
    )
    assert r.status_code == 422, r.text


async def test_an_unknown_tag_logic_is_rejected(client, app_state, make_user):
    _, alice = await make_user()
    r = await client.get(
        "/api/links", params={"tag": "rust", "tag_logic": "either"}, headers=alice
    )
    assert r.status_code == 422, r.text
