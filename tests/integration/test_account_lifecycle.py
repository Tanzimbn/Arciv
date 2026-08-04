"""Data export + account deletion (NFR-PUB-07).

Two failure modes worth a regression net: an export that leaks another user's
rows or the account's own secrets, and a delete that leaves orphaned rows behind
(which would then be invisible-but-present user data).
"""
import pytest
from sqlalchemy import func, select

pytestmark = pytest.mark.integration

PASSWORD = "Testpass123"


async def _seed(client, headers):
    r = await client.post("/api/links", json={"url": "https://example.com/mine"}, headers=headers)
    assert r.status_code == 201
    await client.post(
        "/api/feeds",
        json={
            "feed_url": "https://example.com/mine.xml",
            "site_url": "https://example.com",
            "title": "Mine",
        },
        headers=headers,
    )
    return r.json()["id"]


async def test_export_contains_only_your_own_data(client, app_state, make_user):
    _, alice = await make_user("alice@example.com")
    _, bob = await make_user("bob@example.com")
    await _seed(client, alice)
    await client.post("/api/links", json={"url": "https://example.com/bobs"}, headers=bob)

    r = await client.get("/api/account/export", headers=alice)
    assert r.status_code == 200
    body = r.json()

    urls = {x["canonical_url"] for x in body["links"]}
    assert urls == {"https://example.com/mine"}
    assert "bobs" not in r.text
    assert body["profile"]["email"] == "alice@example.com"
    assert len(body["feeds"]) == 1


async def test_export_never_includes_secrets(client, app_state, make_user):
    _, alice = await make_user()
    await client.patch(
        "/api/settings",
        json={"ai_provider": "gemini", "ai_api_key": "sk-secret-in-export-check"},
        headers=alice,
    )
    await _seed(client, alice)

    r = await client.get("/api/account/export", headers=alice)
    text = r.text
    assert "sk-secret-in-export-check" not in text
    assert "password_hash" not in text
    assert "ai_api_key_enc" not in text
    assert "env:v1:" not in text, "encrypted key blob leaked into the export"
    # It should still tell the user whether a key is set.
    assert r.json()["profile"]["ai_key_configured"] is True


async def test_export_omits_the_raw_embedding_vector(client, app_state, make_user):
    """A 384-float vector per link would bloat the export and means nothing to a
    user — the export contract deliberately excludes it."""
    _, alice = await make_user()
    await _seed(client, alice)
    body = (await client.get("/api/account/export", headers=alice)).json()
    assert "embedding" not in body["links"][0]
    assert "ai_raw_response" not in body["links"][0]


async def test_export_is_served_as_a_download(client, app_state, make_user):
    _, alice = await make_user()
    r = await client.get("/api/account/export", headers=alice)
    assert "attachment" in r.headers["content-disposition"]
    assert ".json" in r.headers["content-disposition"]


# --------------------------------------------------------------------------- #
# Deletion
# --------------------------------------------------------------------------- #
async def test_delete_requires_the_current_password(client, app_state, make_user):
    _, alice = await make_user(password=PASSWORD)
    r = await client.request(
        "DELETE", "/api/account", json={"password": "Wrongpass999"}, headers=alice
    )
    assert r.status_code == 403
    # Account still works.
    assert (await client.get("/api/links", headers=alice)).status_code == 200


async def test_delete_removes_the_account_and_cascades(
    client, app_state, make_user, session_factory
):
    from api.models.feed import Feed, FeedItem
    from api.models.link import Link
    from api.models.notification import Notification
    from api.models.refresh_token import RefreshToken
    from api.models.user import User

    user_id, alice = await make_user(password=PASSWORD)
    await _seed(client, alice)

    async with session_factory() as db:
        db.add(Notification(user_id=user_id, type="feed", title="n", body="b"))
        await db.commit()

    r = await client.request("DELETE", "/api/account", json={"password": PASSWORD}, headers=alice)
    assert r.status_code == 204

    async with session_factory() as db:
        assert (
            await db.execute(select(func.count()).select_from(User).where(User.id == user_id))
        ).scalar_one() == 0
        for model, col in (
            (Link, Link.user_id),
            (Feed, Feed.user_id),
            (Notification, Notification.user_id),
            (RefreshToken, RefreshToken.user_id),
        ):
            left = (
                await db.execute(select(func.count()).select_from(model).where(col == user_id))
            ).scalar_one()
            assert left == 0, f"{model.__name__} rows survived account deletion"
        # feed_items hang off feeds, so they must go too.
        assert (await db.execute(select(func.count()).select_from(FeedItem))).scalar_one() == 0

    # The token is now useless.
    assert (await client.get("/api/links", headers=alice)).status_code == 401


async def test_delete_does_not_touch_other_accounts(client, app_state, make_user, session_factory):
    from api.models.link import Link

    _, alice = await make_user("alice@example.com", password=PASSWORD)
    bob_id, bob = await make_user("bob@example.com", password=PASSWORD)
    await _seed(client, alice)
    await _seed(client, bob)

    r = await client.request("DELETE", "/api/account", json={"password": PASSWORD}, headers=alice)
    assert r.status_code == 204

    async with session_factory() as db:
        left = (
            await db.execute(select(func.count()).select_from(Link).where(Link.user_id == bob_id))
        ).scalar_one()
    assert left == 1
    assert (await client.get("/api/links", headers=bob)).status_code == 200


# --------------------------------------------------------------------------- #
# Usage meter
# --------------------------------------------------------------------------- #
async def test_usage_reports_real_counts_against_configured_caps(
    client, app_state, make_user, monkeypatch
):
    from api.config import settings

    monkeypatch.setattr(settings, "MAX_LINKS_PER_USER", 10)
    monkeypatch.setattr(settings, "MAX_FEEDS_PER_USER", 5)
    monkeypatch.setattr(settings, "MAX_STORAGE_BYTES_PER_USER", 1000)

    _, alice = await make_user()
    await _seed(client, alice)

    body = (await client.get("/api/settings/usage", headers=alice)).json()
    assert body["links"] == {"used": 1, "limit": 10}
    assert body["feeds"] == {"used": 1, "limit": 5}
    assert body["storage"]["limit"] == 1000
    assert body["storage"]["used"] > 0


async def test_usage_reports_zero_limits_when_unlimited(client, app_state, make_user):
    _, alice = await make_user()
    body = (await client.get("/api/settings/usage", headers=alice)).json()
    assert body["links"]["limit"] == 0
    assert body["feeds"]["limit"] == 0
    assert body["storage"]["limit"] == 0
