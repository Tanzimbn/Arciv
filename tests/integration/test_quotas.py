"""Per-account resource quotas (NFR-PUB-03).

Every quota defaults to 0 = unlimited so self-hosting stays unrestricted; the
tests flip each one on for the duration of a single test. The "0 means
unlimited" half matters as much as the enforcement half — a quota that
accidentally treats 0 as "zero allowed" bricks every self-host install.
"""
import pytest

pytestmark = pytest.mark.integration


async def _save(client, headers, n):
    return await client.post("/api/links", json={"url": f"https://example.com/p{n}"}, headers=headers)


# --------------------------------------------------------------------------- #
# Link count
# --------------------------------------------------------------------------- #
async def test_link_quota_blocks_at_the_limit(client, app_state, make_user, monkeypatch):
    from api.config import settings

    monkeypatch.setattr(settings, "MAX_LINKS_PER_USER", 3)
    _, alice = await make_user()

    for i in range(3):
        assert (await _save(client, alice, i)).status_code == 201, f"link {i} should fit"

    r = await _save(client, alice, 99)
    assert r.status_code == 403
    assert "limit reached" in r.json()["detail"].lower()

    # Deleting frees a slot — the quota is a ceiling, not a lifetime counter.
    links = (await client.get("/api/links", headers=alice)).json()
    assert (await client.delete(f"/api/links/{links[0]['id']}", headers=alice)).status_code == 204
    assert (await _save(client, alice, 100)).status_code == 201


async def test_link_quota_is_per_user_not_global(client, app_state, make_user, monkeypatch):
    from api.config import settings

    monkeypatch.setattr(settings, "MAX_LINKS_PER_USER", 1)
    _, alice = await make_user("alice@example.com")
    _, bob = await make_user("bob@example.com")

    assert (await _save(client, alice, 1)).status_code == 201
    assert (await _save(client, alice, 2)).status_code == 403
    # Bob's allowance is untouched by Alice hitting hers.
    assert (await _save(client, bob, 3)).status_code == 201


async def test_zero_means_unlimited(client, app_state, make_user, monkeypatch):
    from api.config import settings

    monkeypatch.setattr(settings, "MAX_LINKS_PER_USER", 0)
    _, alice = await make_user()
    for i in range(5):
        assert (await _save(client, alice, i)).status_code == 201


# --------------------------------------------------------------------------- #
# Storage bytes
# --------------------------------------------------------------------------- #
async def test_storage_cap_blocks_once_the_running_total_is_exceeded(
    client, app_state, make_user, monkeypatch, session_factory
):
    from sqlalchemy import select

    from api.config import settings
    from api.models.user import User

    # Small enough that one stubbed link's metadata (~100 bytes) crosses it.
    monkeypatch.setattr(settings, "MAX_STORAGE_BYTES_PER_USER", 120)
    user_id, alice = await make_user()

    assert (await _save(client, alice, 1)).status_code == 201

    async with session_factory() as db:
        used = (await db.execute(select(User.storage_bytes).where(User.id == user_id))).scalar_one()
    assert used > 0, "storage_bytes was not credited on create"

    r = await _save(client, alice, 2)
    if used >= 120:
        assert r.status_code == 403
        assert "storage limit" in r.json()["detail"].lower()
    else:  # pragma: no cover — only if the stub metadata ever shrinks
        pytest.fail(f"stub link only used {used} bytes; raise the fixture content or lower the cap")


async def test_storage_cap_of_zero_is_unlimited(client, app_state, make_user, monkeypatch):
    from api.config import settings

    monkeypatch.setattr(settings, "MAX_STORAGE_BYTES_PER_USER", 0)
    _, alice = await make_user()
    for i in range(3):
        assert (await _save(client, alice, i)).status_code == 201


async def test_freeing_storage_lets_saves_resume(
    client, app_state, make_user, monkeypatch, session_factory
):
    from sqlalchemy import select

    from api.config import settings
    from api.models.user import User

    user_id, alice = await make_user()
    monkeypatch.setattr(settings, "MAX_STORAGE_BYTES_PER_USER", 0)
    r = await _save(client, alice, 1)
    link_id = r.json()["id"]

    async with session_factory() as db:
        used = (await db.execute(select(User.storage_bytes).where(User.id == user_id))).scalar_one()

    # Now cap right at what's already used → next save blocked.
    monkeypatch.setattr(settings, "MAX_STORAGE_BYTES_PER_USER", used)
    assert (await _save(client, alice, 2)).status_code == 403

    # Delete refunds the bytes → save works again.
    assert (await client.delete(f"/api/links/{link_id}", headers=alice)).status_code == 204
    async with session_factory() as db:
        after = (await db.execute(select(User.storage_bytes).where(User.id == user_id))).scalar_one()
    assert after == 0, f"delete did not refund storage bytes (still {after})"
    assert (await _save(client, alice, 3)).status_code == 201


# --------------------------------------------------------------------------- #
# Feed count
# --------------------------------------------------------------------------- #
async def test_feed_quota_blocks_at_the_limit(client, app_state, make_user, monkeypatch):
    from api.config import settings

    monkeypatch.setattr(settings, "MAX_FEEDS_PER_USER", 2)
    _, alice = await make_user()

    for i in range(2):
        r = await client.post(
            "/api/feeds",
            json={
                "feed_url": f"https://example.com/f{i}.xml",
                "site_url": "https://example.com",
                "title": f"Feed {i}",
            },
            headers=alice,
        )
        assert r.status_code in (200, 201), r.text

    r = await client.post(
        "/api/feeds",
        json={
            "feed_url": "https://example.com/f-over.xml",
            "site_url": "https://example.com",
            "title": "Over",
        },
        headers=alice,
    )
    assert r.status_code == 403
    assert "limit" in r.json()["detail"].lower()
