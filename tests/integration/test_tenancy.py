"""Cross-tenant isolation (NFR-PUB-01) — the invariant that makes multi-tenancy safe.

CLAUDE.md: "Every DB query must include a user_id filter. No cross-user access is
possible." One missing filter in one route is a full data breach, so every route
that takes an id is probed with another user's id here. A route added without a
`user_id` predicate should fail this file.
"""
import uuid

import pytest

pytestmark = pytest.mark.integration


async def _create_link(client, headers, url):
    r = await client.post("/api/links", json={"url": url}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


# --------------------------------------------------------------------------- #
# Links
# --------------------------------------------------------------------------- #
async def test_list_shows_only_your_own_links(client, app_state, make_user):
    _, alice = await make_user("alice@example.com")
    _, bob = await make_user("bob@example.com")

    await _create_link(client, alice, "https://example.com/alice-1")
    await _create_link(client, alice, "https://example.com/alice-2")
    await _create_link(client, bob, "https://example.com/bob-1")

    a = (await client.get("/api/links", headers=alice)).json()
    b = (await client.get("/api/links", headers=bob)).json()
    assert {x["canonical_url"] for x in a} == {
        "https://example.com/alice-1",
        "https://example.com/alice-2",
    }
    assert {x["canonical_url"] for x in b} == {"https://example.com/bob-1"}


@pytest.mark.parametrize(
    "method,suffix,payload",
    [
        ("get", "/similar", None),
        ("patch", "", {"queue": "read-later"}),
        ("delete", "", None),
        ("post", "/retry-ai", None),
        ("post", "/insights", None),
    ],
)
async def test_another_users_link_is_not_reachable(
    client, app_state, make_user, method, suffix, payload
):
    _, alice = await make_user("alice@example.com")
    _, bob = await make_user("bob@example.com")
    link = await _create_link(client, alice, "https://example.com/private")

    kwargs = {"headers": bob}
    if payload is not None:
        kwargs["json"] = payload
    r = await getattr(client, method)(f"/api/links/{link['id']}{suffix}", **kwargs)
    assert r.status_code == 404, f"{method.upper()} …{suffix} leaked another user's link"

    # And Alice's link is untouched.
    still_there = (await client.get("/api/links", headers=alice)).json()
    assert len(still_there) == 1


async def test_unknown_link_id_is_404_not_500(client, app_state, make_user):
    _, alice = await make_user()
    r = await client.delete(f"/api/links/{uuid.uuid4()}", headers=alice)
    assert r.status_code == 404


async def test_malformed_link_id_is_422(client, app_state, make_user):
    _, alice = await make_user()
    r = await client.get("/api/links/not-a-uuid/similar", headers=alice)
    assert r.status_code == 422


async def test_dedup_is_per_user_not_global(client, app_state, make_user):
    """`UNIQUE (user_id, canonical_url)`: the same URL must be saveable by two
    users, and re-saving must 409 only for the same user."""
    _, alice = await make_user("alice@example.com")
    _, bob = await make_user("bob@example.com")

    await _create_link(client, alice, "https://example.com/shared")
    r = await client.post("/api/links", json={"url": "https://example.com/shared"}, headers=alice)
    assert r.status_code == 409
    assert "link_id" in r.json()["detail"]

    # Bob is unaffected.
    await _create_link(client, bob, "https://example.com/shared")


async def test_tracking_params_dedup_to_the_same_link(client, app_state, make_user):
    _, alice = await make_user()
    await _create_link(client, alice, "https://example.com/post?id=1")
    r = await client.post(
        "/api/links",
        json={"url": "https://example.com/post?id=1&utm_source=twitter"},
        headers=alice,
    )
    assert r.status_code == 409


# --------------------------------------------------------------------------- #
# Feeds
# --------------------------------------------------------------------------- #
async def _create_feed(client, headers, feed_url, site_url="https://example.com"):
    r = await client.post(
        "/api/feeds",
        json={"feed_url": feed_url, "site_url": site_url, "title": "Example feed"},
        headers=headers,
    )
    return r


async def test_feeds_are_user_scoped(client, app_state, make_user):
    _, alice = await make_user("alice@example.com")
    _, bob = await make_user("bob@example.com")

    r = await _create_feed(client, alice, "https://example.com/feed.xml")
    assert r.status_code in (200, 201), r.text
    feed_id = r.json()["id"]

    assert (await client.get("/api/feeds", headers=bob)).json() == []
    assert len((await client.get("/api/feeds", headers=alice)).json()) == 1

    for method, suffix, payload in [
        ("patch", "", {"status": "paused"}),
        ("post", "/check-now", None),
        ("delete", "", None),
    ]:
        kwargs = {"headers": bob}
        if payload is not None:
            kwargs["json"] = payload
        r = await getattr(client, method)(f"/api/feeds/{feed_id}{suffix}", **kwargs)
        assert r.status_code == 404, f"{method.upper()} feeds/…{suffix} leaked another user's feed"


# --------------------------------------------------------------------------- #
# Notifications
# --------------------------------------------------------------------------- #
async def test_notifications_are_user_scoped(client, app_state, make_user, session_factory):
    from api.models.notification import Notification

    alice_id, alice = await make_user("alice@example.com")
    bob_id, bob = await make_user("bob@example.com")

    async with session_factory() as db:
        db.add(Notification(user_id=alice_id, type="feed", title="Alice only", body="x"))
        db.add(Notification(user_id=bob_id, type="feed", title="Bob only", body="y"))
        await db.commit()

    a = (await client.get("/api/notifications", headers=alice)).json()
    items = a["items"] if isinstance(a, dict) else a
    assert [n["title"] for n in items] == ["Alice only"]

    # Marking all read must not touch Bob's rows.
    assert (await client.post("/api/notifications/read-all", headers=alice)).status_code in (200, 204)
    b = (await client.get("/api/notifications", headers=bob)).json()
    bitems = b["items"] if isinstance(b, dict) else b
    assert bitems[0]["is_read"] is False


# --------------------------------------------------------------------------- #
# Settings / secrets
# --------------------------------------------------------------------------- #
async def test_settings_never_return_the_raw_api_key(client, app_state, make_user):
    _, alice = await make_user()
    r = await client.patch(
        "/api/settings",
        json={"ai_provider": "gemini", "ai_api_key": "sk-supersecret-value-123"},
        headers=alice,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "sk-supersecret-value-123" not in str(body)
    assert "ai_api_key" not in body or body.get("ai_api_key") is None

    r = await client.get("/api/settings", headers=alice)
    assert "supersecret" not in r.text
    # Recognisable, not reusable: the tail identifies which key this is (every
    # key from a provider shares its prefix), the middle never leaves the DB.
    masked = r.json()["ai_api_key_masked"]
    assert masked == "sk-s...-123"
    assert "supersecret" not in masked


async def test_stored_api_key_is_encrypted_at_rest(client, app_state, make_user, session_factory):
    from sqlalchemy import select

    from api.models.user import User
    from api.utils.encryption import decrypt_secret

    user_id, alice = await make_user()
    secret = "sk-plaintext-must-not-be-stored"
    r = await client.patch(
        "/api/settings", json={"ai_provider": "gemini", "ai_api_key": secret}, headers=alice
    )
    assert r.status_code == 200

    async with session_factory() as db:
        user = (await db.execute(select(User).where(User.id == user_id))).scalar_one()
    assert user.ai_api_key_enc is not None
    assert secret not in user.ai_api_key_enc, "API key stored in the clear"
    assert decrypt_secret(user.ai_api_key_enc) == secret


async def test_one_users_key_does_not_appear_in_anothers_settings(client, app_state, make_user):
    _, alice = await make_user("alice@example.com")
    _, bob = await make_user("bob@example.com")
    await client.patch(
        "/api/settings",
        json={"ai_provider": "gemini", "ai_api_key": "sk-alice-key-9999"},
        headers=alice,
    )
    r = await client.get("/api/settings", headers=bob)
    assert r.status_code == 200
    assert "alice" not in r.text.lower()
    assert r.json()["ai_api_key_masked"] is None
