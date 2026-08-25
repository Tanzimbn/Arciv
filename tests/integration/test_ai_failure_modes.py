"""Permanent AI failures are terminal, visible, and announced once.

This is the reported bug, from the bottom up. Groq retired the model Arciv had
hardcoded and answered 404. Nothing classified that as permanent, so:

1. the link went on the backoff ladder — four attempts over ~72 minutes for a
   request that could never succeed, and
2. ``sweep_failed_links`` then reset *every* failed link to ``pending`` hourly,
   so with a 72-minute ladder against a 60-minute cron the link sat in
   ``pending`` most of the time, which the UI renders as "Classifying…".

The link therefore never settled anywhere the UI could report, and the provider's
real message went nowhere. Each of those three properties is asserted separately
below.

The provider is faked (the suite never touches the network), but everything the
tests are actually about — the SQL the sweep runs, the Redis dedupe, the state
machine in ``classify_link`` — is real.
"""
import pytest
from sqlalchemy import select

from agent.errors import AuthError, ModelError
from api.models.link import Link
from api.models.notification import Notification
from api.utils.encryption import encrypt_secret

pytestmark = pytest.mark.integration


class RaisingProvider:
    """A provider whose every call fails the same way, counting attempts."""

    def __init__(self, exc):
        self.exc = exc
        self.calls = 0

    async def classify_and_summarise(self, title, content, url):
        self.calls += 1
        raise self.exc

    async def generate(self, system, user_message):
        raise self.exc

    async def list_models(self):
        raise self.exc


@pytest.fixture
def patch_provider(monkeypatch):
    """Swap the provider factory `classify_link` uses. Returns a setter that
    hands back the fake, so a test can assert how many times it was called."""
    from worker import ai_classify

    def _set(exc):
        provider = RaisingProvider(exc)
        monkeypatch.setattr(ai_classify, "make_provider", lambda *a, **k: provider)
        return provider

    return _set


async def _byok_user(make_user, provider="groq", model="does-not-exist-1b"):
    return await make_user(
        ai_provider=provider,
        ai_model=model,
        ai_api_key_enc=encrypt_secret("gsk_test_key"),
    )


async def _save_link(client, headers, url):
    r = await client.post("/api/links", json={"url": url}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _get_link(session_factory, link_id):
    import uuid as _uuid

    async with session_factory() as db:
        return await db.get(Link, _uuid.UUID(str(link_id)))


# --------------------------------------------------------------------------- #
# 1. Terminal on the first attempt — no ladder
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize(
    "exc,kind",
    [
        (ModelError("The model `does-not-exist-1b` has been decommissioned"), "model"),
        (AuthError("Invalid API Key"), "credentials"),
    ],
)
async def test_permanent_failure_is_terminal_on_the_first_attempt(
    exc, kind, client, app_state, make_user, session_factory, patch_provider
):
    """One attempt, then ``failed`` with ``ai_error_kind="config"``. Crucially no
    retry job is enqueued: the ladder is what hid the problem for 72 minutes."""
    from worker.ai_classify import classify_link

    _, alice = await _byok_user(make_user)
    link_id = await _save_link(client, alice, "https://example.com/perm")
    provider = patch_provider(exc)

    app_state.jobs.clear()
    await classify_link({"redis": app_state}, str(link_id))

    link = await _get_link(session_factory, link_id)
    assert link.ai_status == "failed"
    assert link.ai_error_kind == "config"
    assert kind in link.ai_error
    assert str(exc) in link.ai_error, "the provider's own words must reach the row"
    assert link.ai_attempt_count == 1
    assert provider.calls == 1
    assert app_state.job_args("classify_link") == [], "a permanent error was put on the ladder"


async def test_transient_failure_still_uses_the_ladder(
    client, app_state, make_user, session_factory, patch_provider
):
    """The counterweight: fixing the permanent case must not stop retrying the
    transient one. A 500 from the provider is worth another go."""
    from worker.ai_classify import classify_link

    _, alice = await _byok_user(make_user, model=None)
    link_id = await _save_link(client, alice, "https://example.com/transient")
    patch_provider(RuntimeError("upstream 503"))

    app_state.jobs.clear()
    await classify_link({"redis": app_state}, str(link_id))

    link = await _get_link(session_factory, link_id)
    assert link.ai_status == "pending"
    assert link.ai_error_kind is None
    assert link.ai_next_retry_at is not None
    assert app_state.job_args("classify_link") == [(str(link_id),)]


# --------------------------------------------------------------------------- #
# 2. The sweep leaves it alone — the actual "Classifying… forever" cause
# --------------------------------------------------------------------------- #

async def test_sweep_skips_config_failures_but_still_requeues_transient_ones(
    client, app_state, make_user, session_factory, patch_provider
):
    """Both halves in one test, because the risk is symmetric: the predicate has
    to be ``IS DISTINCT FROM``. A plain ``!= 'config'`` is NULL for every row
    written before the column existed, which would silently stop retrying *all*
    transient failures — worse than the bug being fixed."""
    from worker.ai_classify import sweep_failed_links

    _, alice = await _byok_user(make_user)
    permanent = await _save_link(client, alice, "https://example.com/stuck")
    transient = await _save_link(client, alice, "https://example.com/flaky")

    import uuid as _uuid

    async with session_factory() as db:
        a = await db.get(Link, _uuid.UUID(str(permanent)))
        a.ai_status, a.ai_error_kind, a.ai_error = "failed", "config", "model gone"
        b = await db.get(Link, _uuid.UUID(str(transient)))
        # NULL kind — exactly the shape of every pre-existing failed row.
        b.ai_status, b.ai_error_kind, b.ai_error = "failed", None, "boom"
        await db.commit()

    app_state.jobs.clear()
    await sweep_failed_links({"redis": app_state})

    assert app_state.job_args("classify_link") == [(str(transient),)]
    assert (await _get_link(session_factory, permanent)).ai_status == "failed"
    assert (await _get_link(session_factory, transient)).ai_status == "pending"


async def test_retry_ai_clears_the_config_marker(
    client, app_state, make_user, session_factory, patch_provider
):
    """The escape hatch. The sweep ignores ``config`` rows, so if Retry didn't
    clear the marker a user who fixed their model could never un-stick the link."""
    from worker.ai_classify import classify_link

    _, alice = await _byok_user(make_user)
    link_id = await _save_link(client, alice, "https://example.com/retryable")
    patch_provider(ModelError("model_decommissioned"))
    await classify_link({"redis": app_state}, str(link_id))
    assert (await _get_link(session_factory, link_id)).ai_error_kind == "config"

    app_state.jobs.clear()
    r = await client.post(f"/api/links/{link_id}/retry-ai", headers=alice)
    assert r.status_code == 200, r.text

    link = await _get_link(session_factory, link_id)
    assert link.ai_error_kind is None
    assert link.ai_error is None
    assert link.ai_status == "pending"
    assert link.ai_attempt_count == 0
    assert app_state.job_args("classify_link") == [(str(link_id),)]


# --------------------------------------------------------------------------- #
# 3. One notification per broken config, not one per link
# --------------------------------------------------------------------------- #

async def test_broken_config_notifies_once_no_matter_how_many_links_fail(
    client, app_state, make_user, session_factory, patch_provider
):
    """A retired model breaks every link the user saves. Fifty identical
    notifications is the same as none, so the alert is deduped in Redis for a
    day and each link still carries its own ``ai_error``."""
    from worker.ai_classify import classify_link

    user_id, alice = await _byok_user(make_user)
    ids = [await _save_link(client, alice, f"https://example.com/n{i}") for i in range(3)]
    patch_provider(ModelError("The model `does-not-exist-1b` has been decommissioned"))

    for link_id in ids:
        await classify_link({"redis": app_state}, str(link_id))

    async with session_factory() as db:
        notes = (
            await db.execute(
                select(Notification).where(
                    Notification.user_id == user_id, Notification.type == "ai_config"
                )
            )
        ).scalars().all()

    assert len(notes) == 1, f"expected one alert, got {len(notes)}"
    assert "decommissioned" in notes[0].body, "the provider's message must reach the user"
    assert "Settings" in notes[0].body, "the alert has to say where to fix it"
    for link_id in ids:
        assert (await _get_link(session_factory, link_id)).ai_status == "failed"


async def test_notification_is_per_user(
    client, app_state, make_user, session_factory, patch_provider
):
    """The dedupe key is per-user: Bob's broken key must not be silenced by
    Alice's alert."""
    from worker.ai_classify import classify_link

    alice_id, alice = await _byok_user(make_user)
    bob_id, bob = await _byok_user(make_user)
    a_link = await _save_link(client, alice, "https://example.com/pa")
    b_link = await _save_link(client, bob, "https://example.com/pb")
    patch_provider(AuthError("Invalid API Key"))

    await classify_link({"redis": app_state}, str(a_link))
    await classify_link({"redis": app_state}, str(b_link))

    async with session_factory() as db:
        for uid in (alice_id, bob_id):
            notes = (
                await db.execute(
                    select(Notification).where(
                        Notification.user_id == uid, Notification.type == "ai_config"
                    )
                )
            ).scalars().all()
            assert len(notes) == 1, f"user {uid} got {len(notes)} alerts"
