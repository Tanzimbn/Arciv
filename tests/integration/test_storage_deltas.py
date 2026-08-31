"""`users.storage_bytes` stays consistent across every mutation site.

The running total is maintained by hand-written deltas, so the risk is drift: a
site that adds bytes but never refunds them, or an edit that double-counts. Each
test here compares the running total against a full recomputation from the rows.
"""
import pytest
from sqlalchemy import select

from api.models.link import Link
from api.models.user import User
from api.utils.storage import link_bytes

pytestmark = pytest.mark.integration


async def _running_total(session_factory, user_id) -> int:
    async with session_factory() as db:
        return (await db.execute(select(User.storage_bytes).where(User.id == user_id))).scalar_one()


async def _recomputed_total(session_factory, user_id) -> int:
    async with session_factory() as db:
        links = (await db.execute(select(Link).where(Link.user_id == user_id))).scalars().all()
        return sum(link_bytes(x) for x in links)


async def _assert_consistent(session_factory, user_id):
    running = await _running_total(session_factory, user_id)
    truth = await _recomputed_total(session_factory, user_id)
    assert running == truth, f"storage_bytes drifted: running={running} actual={truth}"
    return running


async def test_create_credits_and_delete_refunds(client, app_state, make_user, session_factory):
    user_id, alice = await make_user()
    assert await _running_total(session_factory, user_id) == 0

    ids = []
    for i in range(3):
        r = await client.post("/api/links", json={"url": f"https://example.com/s{i}"}, headers=alice)
        assert r.status_code == 201
        ids.append(r.json()["id"])
        await _assert_consistent(session_factory, user_id)

    for link_id in ids:
        assert (await client.delete(f"/api/links/{link_id}", headers=alice)).status_code == 204
        await _assert_consistent(session_factory, user_id)

    assert await _running_total(session_factory, user_id) == 0, "deletes did not fully refund"


async def test_adding_notes_increases_the_total_by_the_note_size(
    client, app_state, make_user, session_factory
):
    user_id, alice = await make_user()
    r = await client.post("/api/links", json={"url": "https://example.com/n"}, headers=alice)
    link_id = r.json()["id"]
    before = await _assert_consistent(session_factory, user_id)

    note = "x" * 500
    r = await client.patch(f"/api/links/{link_id}", json={"notes": note}, headers=alice)
    assert r.status_code == 200
    after = await _assert_consistent(session_factory, user_id)
    assert after - before == 500


async def test_shrinking_notes_refunds(client, app_state, make_user, session_factory):
    user_id, alice = await make_user()
    r = await client.post("/api/links", json={"url": "https://example.com/n2"}, headers=alice)
    link_id = r.json()["id"]

    await client.patch(f"/api/links/{link_id}", json={"notes": "y" * 400}, headers=alice)
    big = await _assert_consistent(session_factory, user_id)
    await client.patch(f"/api/links/{link_id}", json={"notes": "y" * 100}, headers=alice)
    small = await _assert_consistent(session_factory, user_id)
    assert big - small == 300

    # Whitespace-only notes are stored as NULL, so the whole note is refunded.
    await client.patch(f"/api/links/{link_id}", json={"notes": "   "}, headers=alice)
    cleared = await _assert_consistent(session_factory, user_id)
    assert cleared == small - 100


async def test_tag_edits_are_accounted(client, app_state, make_user, session_factory):
    user_id, alice = await make_user()
    r = await client.post("/api/links", json={"url": "https://example.com/t"}, headers=alice)
    link_id = r.json()["id"]
    before = await _assert_consistent(session_factory, user_id)

    await client.patch(f"/api/links/{link_id}", json={"ai_tags": ["rust", "async"]}, headers=alice)
    after = await _assert_consistent(session_factory, user_id)
    assert after - before == len("rust") + len("async")


async def test_status_only_edits_do_not_change_the_total(
    client, app_state, make_user, session_factory
):
    """A queue move or archive must be byte-neutral, or every UI interaction
    slowly inflates the user's usage."""
    user_id, alice = await make_user()
    r = await client.post("/api/links", json={"url": "https://example.com/q"}, headers=alice)
    link_id = r.json()["id"]
    before = await _assert_consistent(session_factory, user_id)

    for payload in ({"queue": "watch-later"}, {"status": "done"}, {"status": "active"}):
        await client.patch(f"/api/links/{link_id}", json=payload, headers=alice)
        assert await _assert_consistent(session_factory, user_id) == before


async def test_one_users_activity_never_touches_anothers_total(
    client, app_state, make_user, session_factory
):
    alice_id, alice = await make_user("alice@example.com")
    bob_id, bob = await make_user("bob@example.com")

    await client.post("/api/links", json={"url": "https://example.com/x"}, headers=alice)
    assert await _running_total(session_factory, bob_id) == 0
    await client.post("/api/links", json={"url": "https://example.com/y"}, headers=bob)
    await _assert_consistent(session_factory, alice_id)
    await _assert_consistent(session_factory, bob_id)


async def test_total_is_floored_at_zero(client, app_state, make_user, session_factory):
    """`func.greatest(0, ...)` guards against a negative total if a delta ever
    over-refunds — a negative would read as 'unlimited headroom'."""
    from api.utils.storage import adjust_user_storage

    user_id, _ = await make_user()
    async with session_factory() as db:
        await adjust_user_storage(db, user_id, -5000)
        await db.commit()
    assert await _running_total(session_factory, user_id) == 0


async def test_worker_embedding_delta_is_accounted(
    client, app_state, make_user, session_factory, monkeypatch
):
    """The embedding is written asynchronously by the worker, which must apply its
    own delta — a create-only delta would undercount by 1.5KB per link."""
    from conftest import fake_vector

    from api.config import settings
    from worker import embed as embed_job

    monkeypatch.setattr(settings, "EMBEDDINGS_ENABLED", True)
    user_id, alice = await make_user()
    r = await client.post("/api/links", json={"url": "https://example.com/e"}, headers=alice)
    link_id = r.json()["id"]
    before = await _assert_consistent(session_factory, user_id)

    async def _embed(text):
        return fake_vector(text)

    monkeypatch.setattr(embed_job, "embed_text", _embed)
    await embed_job.embed_link({}, link_id)

    after = await _assert_consistent(session_factory, user_id)
    from api.utils.storage import EMBEDDING_BYTES

    assert after - before == EMBEDDING_BYTES

    # Re-embedding must not double-count.
    await embed_job.embed_link({}, link_id)
    assert await _assert_consistent(session_factory, user_id) == after


async def test_terminal_ai_failure_accounts_for_the_error_text(
    client, app_state, make_user, session_factory, monkeypatch
):
    """`ai_error` is in `storage._TEXT_FIELDS`, so the branch that writes it has
    to apply its own delta. A provider message can be long, and a per-account
    byte cap that silently undercounts is a cap that doesn't hold."""
    from agent.errors import ModelError
    from worker import ai_classify
    from api.utils.encryption import encrypt_secret

    user_id, alice = await make_user(
        ai_provider="groq", ai_model="gone-1b", ai_api_key_enc=encrypt_secret("k")
    )
    r = await client.post("/api/links", json={"url": "https://example.com/ai-fail"}, headers=alice)
    link_id = r.json()["id"]
    before = await _assert_consistent(session_factory, user_id)

    message = "The model `gone-1b` has been decommissioned. " * 4

    class Fake:
        async def classify_and_summarise(self, title, content, url):
            raise ModelError(message)

    monkeypatch.setattr(ai_classify, "make_provider", lambda *a, **k: Fake())
    await ai_classify.classify_link({"redis": app_state}, link_id)

    after = await _assert_consistent(session_factory, user_id)
    assert after > before, "the error text was stored but never accounted"


async def test_transient_ai_failure_error_text_is_accounted_and_refunded(
    client, app_state, make_user, session_factory, monkeypatch
):
    """The retry branch writes `ai_error` too, and a later success clears it —
    both directions have to move the total, or every retried link leaks bytes."""
    from agent.base import AIResult
    from worker import ai_classify
    from api.utils.encryption import encrypt_secret

    user_id, alice = await make_user(ai_provider="groq", ai_api_key_enc=encrypt_secret("k"))
    r = await client.post("/api/links", json={"url": "https://example.com/ai-flaky"}, headers=alice)
    link_id = r.json()["id"]
    before = await _assert_consistent(session_factory, user_id)

    class Flaky:
        def __init__(self):
            self.calls = 0

        async def classify_and_summarise(self, title, content, url):
            self.calls += 1
            if self.calls == 1:
                raise RuntimeError("upstream 503 " * 20)
            return AIResult(
                content_type="article", queue="read-later", summary="ok",
                tags=["x"], raw_response={},
            )

    flaky = Flaky()
    monkeypatch.setattr(ai_classify, "make_provider", lambda *a, **k: flaky)

    await ai_classify.classify_link({"redis": app_state}, link_id)
    failed_total = await _assert_consistent(session_factory, user_id)
    assert failed_total > before

    await ai_classify.classify_link({"redis": app_state}, link_id)
    await _assert_consistent(session_factory, user_id)
