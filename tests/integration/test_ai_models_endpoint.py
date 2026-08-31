"""`POST /api/settings/ai/models` — the live model list behind the Settings picker.

It exists because a hardcoded model table *is* the bug: providers retire models
on their own schedule, and a redeploy is not an acceptable fix path for a user
whose links have stopped classifying. So the list comes from the provider's own
catalogue, using the user's own key.

That makes it an authenticated, user-triggered outbound call, which is why the
rate limit and the cache are part of the contract and not polish. The provider is
faked — the suite never touches the network — but the auth, the Redis limiter and
the Redis cache are real.

It is a POST because the body may carry a key the user has typed but *not saved*:
listing models is the cheapest credential check there is, so "paste key → is it
good → here are your models" is one request, and a secret must never travel in a
URL. A refused key is a 400 (the caller's input), never a 502 (the provider's
fault) — the UI has to be able to say which field to fix.
"""
import json

import pytest

from api.utils.encryption import encrypt_secret

pytestmark = pytest.mark.integration

MODELS = ["llama-3.1-8b-instant", "llama-3.3-70b-versatile"]


@pytest.fixture
def patch_models(monkeypatch):
    """Make `make_provider` in the settings router return a fake whose
    `list_models` is scripted. Returns a list of call markers so a test can prove
    the second request never reached the provider."""
    from api.routers import settings as settings_router

    calls: list[tuple] = []

    def _set(result=MODELS, exc=None):
        class Fake:
            async def list_models(self):
                if exc is not None:
                    raise exc
                return list(result)

        def _make(provider, api_key, model=None):
            # Recorded, so a test can prove *which* credential was used: the
            # typed one, the stored one, or the instance's shared key.
            calls.append((provider, api_key, model))
            return Fake()

        monkeypatch.setattr(settings_router, "make_provider", _make)
        return calls

    return _set


async def _byok_user(make_user, provider="groq", model=None):
    return await make_user(
        ai_provider=provider,
        ai_model=model,
        ai_api_key_enc=encrypt_secret("gsk_test_key"),
    )


# --------------------------------------------------------------------------- #
# Access
# --------------------------------------------------------------------------- #

async def test_unauthenticated_is_rejected(client, app_state):
    r = await client.post("/api/settings/ai/models", json={})
    assert r.status_code in (401, 403), r.status_code


async def test_no_key_configured_is_422_not_a_provider_call(client, app_state, make_user, patch_models):
    """Nothing to list without a credential, and the error has to be actionable
    rather than a 502 blaming the provider."""
    calls = patch_models()
    _, alice = await make_user()  # no ai_api_key_enc

    r = await client.post("/api/settings/ai/models", json={}, headers=alice)

    assert r.status_code == 422
    assert "key" in r.json()["detail"].lower()
    assert calls == []


# --------------------------------------------------------------------------- #
# The list
# --------------------------------------------------------------------------- #

async def test_returns_the_provider_list_and_the_default(client, app_state, make_user, patch_models):
    """`default` is what the UI labels the "Provider default" entry with, so the
    user can see which model a NULL `ai_model` actually resolves to."""
    from agent.registry import default_model_for

    patch_models()
    _, alice = await _byok_user(make_user)

    r = await client.post("/api/settings/ai/models", json={}, headers=alice)

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["provider"] == "groq"
    assert body["models"] == MODELS
    assert body["default"] == default_model_for("groq")
    assert body["cached"] is False


async def test_provider_error_is_502_carrying_the_provider_message(
    client, app_state, make_user, patch_models
):
    """A provider outage is the user's to know about. A generic message would hide
    exactly the sentence they need to read."""
    patch_models(exc=RuntimeError("upstream connect error"))
    _, alice = await _byok_user(make_user)

    r = await client.post("/api/settings/ai/models", json={}, headers=alice)

    assert r.status_code == 502
    assert r.json()["detail"] == "upstream connect error"


async def test_provider_error_is_not_cached(client, app_state, make_user, patch_models):
    """Caching a failure would leave the user staring at their own stale error
    for an hour after fixing the key."""
    calls = patch_models(exc=RuntimeError("temporarily unavailable"))
    _, alice = await _byok_user(make_user)

    assert (await client.post("/api/settings/ai/models", json={}, headers=alice)).status_code == 502
    assert (await client.post("/api/settings/ai/models", json={}, headers=alice)).status_code == 502
    assert len(calls) == 2


# --------------------------------------------------------------------------- #
# Cache
# --------------------------------------------------------------------------- #

async def test_second_call_is_served_from_cache_without_touching_the_provider(
    client, app_state, make_user, patch_models
):
    """Opening Settings must not bill a provider request every time."""
    calls = patch_models()
    _, alice = await _byok_user(make_user)

    first = await client.post("/api/settings/ai/models", json={}, headers=alice)
    second = await client.post("/api/settings/ai/models", json={}, headers=alice)

    assert first.json()["cached"] is False
    assert second.json()["cached"] is True
    assert second.json()["models"] == MODELS
    assert len(calls) == 1, f"provider was called {len(calls)} times"


async def test_cache_entry_carries_a_ttl(client, app_state, make_user, patch_models, redis_client, monkeypatch):
    """Without an expiry, a retired model would stay listed forever — the bug
    this endpoint exists to prevent, reintroduced in the cache."""
    from api.config import settings

    monkeypatch.setattr(settings, "AI_MODELS_CACHE_TTL", 120)
    patch_models()
    _, alice = await _byok_user(make_user)
    await client.post("/api/settings/ai/models", json={}, headers=alice)

    keys = [k.decode() if isinstance(k, bytes) else k async for k in redis_client.scan_iter("ai_models:*")]
    assert keys, "nothing was cached"
    assert 0 < await redis_client.ttl(keys[0]) <= 120


async def test_cache_is_keyed_on_the_credential_not_the_user(
    client, app_state, make_user, patch_models, redis_client
):
    """Two accounts on the same key see the same catalogue, and — the part that
    matters — a *rotated* key must not read the previous key's list."""
    calls = patch_models()
    _, alice = await _byok_user(make_user)
    _, bob = await _byok_user(make_user)

    assert (await client.post("/api/settings/ai/models", json={}, headers=alice)).json()["cached"] is False
    assert (await client.post("/api/settings/ai/models", json={}, headers=bob)).json()["cached"] is True
    assert len(calls) == 1

    # Alice rotates to a different key: different cache key, fresh fetch.
    assert (await client.patch("/api/settings", json={"ai_api_key": "gsk_rotated"}, headers=alice)).status_code == 200
    assert (await client.post("/api/settings/ai/models", json={}, headers=alice)).json()["cached"] is False
    assert len(calls) == 2

    keys = [k async for k in redis_client.scan_iter("ai_models:*")]
    assert len(keys) == 2


async def test_a_control_character_in_the_typed_key_is_422(
    client, app_state, make_user, patch_models
):
    """CRLF in a header value is request splitting, and Ollama Cloud is the one
    provider whose key we put in a header ourselves rather than handing to an
    SDK. Rejected at the schema, so it never reaches the provider or the DB."""
    patch_models()
    _, alice = await _byok_user(make_user, provider="ollama")

    r = await client.post(
        "/api/settings/ai/models",
        json={"provider": "ollama", "api_key": "key\r\nX-Evil: 1"},
        headers=alice,
    )
    assert r.status_code == 422, r.text


# --------------------------------------------------------------------------- #
# Rate limit
# --------------------------------------------------------------------------- #

async def test_rate_limit_returns_429(client, app_state, make_user, patch_models, monkeypatch):
    """Each miss is an outbound call on the user's key, so the burst guard is
    part of the endpoint, not an add-on. The cache is disabled here so every
    request actually reaches the limiter's protected work."""
    from api.config import settings

    monkeypatch.setattr(settings, "AI_MODELS_PER_MINUTE", 2)
    monkeypatch.setattr(settings, "AI_MODELS_CACHE_TTL", 0)
    patch_models()
    _, alice = await _byok_user(make_user)

    codes = [
        (await client.post("/api/settings/ai/models", json={}, headers=alice)).status_code
        for _ in range(4)
    ]
    assert codes == [200, 200, 429, 429], codes


async def test_rate_limit_is_per_user(client, app_state, make_user, patch_models, monkeypatch):
    from api.config import settings

    monkeypatch.setattr(settings, "AI_MODELS_PER_MINUTE", 1)
    monkeypatch.setattr(settings, "AI_MODELS_CACHE_TTL", 0)
    patch_models()
    _, alice = await _byok_user(make_user)
    _, bob = await _byok_user(make_user)

    assert (await client.post("/api/settings/ai/models", json={}, headers=alice)).status_code == 200
    assert (await client.post("/api/settings/ai/models", json={}, headers=alice)).status_code == 429
    assert (await client.post("/api/settings/ai/models", json={}, headers=bob)).status_code == 200


# --------------------------------------------------------------------------- #
# Saving a choice
# --------------------------------------------------------------------------- #

async def test_model_round_trips_through_settings(client, app_state, make_user, patch_models):
    patch_models()
    _, alice = await _byok_user(make_user)

    r = await client.patch("/api/settings", json={"ai_model": MODELS[1]}, headers=alice)
    assert r.status_code == 200
    assert r.json()["ai_model"] == MODELS[1]
    assert (await client.get("/api/settings", headers=alice)).json()["ai_model"] == MODELS[1]

    # "" means "back to the provider default", which is NULL on the row.
    assert (await client.patch("/api/settings", json={"ai_model": ""}, headers=alice)).json()["ai_model"] is None


async def test_switching_provider_clears_a_stale_model(client, app_state, make_user, patch_models):
    """A Groq model id surviving a switch to OpenAI would 404 every classify —
    the same outage as the reported bug, self-inflicted."""
    patch_models()
    _, alice = await _byok_user(make_user, model=MODELS[1])

    r = await client.patch("/api/settings", json={"ai_provider": "openai"}, headers=alice)

    assert r.status_code == 200
    assert r.json()["ai_provider"] == "openai"
    assert r.json()["ai_model"] is None


async def test_switching_provider_and_model_together_keeps_the_new_model(
    client, app_state, make_user, patch_models
):
    """The clear must not stomp a model supplied in the same PATCH — that is how
    the Settings form saves both fields at once."""
    patch_models()
    _, alice = await _byok_user(make_user, model=MODELS[1])

    r = await client.patch(
        "/api/settings", json={"ai_provider": "openai", "ai_model": "gpt-4o"}, headers=alice
    )

    assert r.json() == {**r.json(), "ai_provider": "openai", "ai_model": "gpt-4o"}


async def test_model_id_is_length_bounded(client, app_state, make_user):
    """Free-text by design (a closed enum would lock the user out of the setting
    that fixes their outage), so the bound is the only guard — and it feeds
    storage accounting."""
    _, alice = await _byok_user(make_user)
    r = await client.patch("/api/settings", json={"ai_model": "x" * 101}, headers=alice)
    assert r.status_code == 422


async def test_cached_list_is_json_and_readable(client, app_state, make_user, patch_models, redis_client):
    patch_models()
    _, alice = await _byok_user(make_user)
    await client.post("/api/settings/ai/models", json={}, headers=alice)

    keys = [k async for k in redis_client.scan_iter("ai_models:*")]
    assert json.loads(await redis_client.get(keys[0])) == MODELS


# --------------------------------------------------------------------------- #
# A key that is typed but not saved
#
# The reported failure: the stored Groq key had expired, so every listing came
# back `401 … expired_api_key` and pasting a new key changed nothing until it was
# saved — you had to save an unverified secret to find out whether it worked.
# --------------------------------------------------------------------------- #

async def test_typed_key_is_used_instead_of_the_stored_one(
    client, app_state, make_user, patch_models, session_factory
):
    """The whole point: check a key *before* committing to it."""
    from sqlalchemy import select

    from api.models.user import User

    calls = patch_models()
    alice_id, alice = await _byok_user(make_user)  # stored key: gsk_test_key

    r = await client.post(
        "/api/settings/ai/models", json={"api_key": "gsk_freshly_pasted"}, headers=alice
    )

    assert r.status_code == 200, r.text
    assert r.json()["models"] == MODELS
    assert r.json()["key_source"] == "typed"
    assert calls == [("groq", "gsk_freshly_pasted", None)]

    # And it is *not* persisted — saving stays an explicit PATCH.
    async with session_factory() as db:
        user = (await db.execute(select(User).where(User.id == alice_id))).scalar_one()
        from api.utils.encryption import decrypt_secret

        assert decrypt_secret(user.ai_api_key_enc) == "gsk_test_key"


async def test_typed_key_works_with_no_key_stored_at_all(client, app_state, make_user, patch_models):
    """A brand-new account has no credential, so without this the picker could
    only ever say "no API key configured" — and the user's first key would have to
    be saved blind."""
    calls = patch_models()
    _, alice = await make_user()  # no ai_api_key_enc

    r = await client.post(
        "/api/settings/ai/models", json={"provider": "openai", "api_key": "sk-typed"}, headers=alice
    )

    assert r.status_code == 200, r.text
    assert r.json()["provider"] == "openai"
    assert calls == [("openai", "sk-typed", None)]


async def test_typed_provider_overrides_the_stored_one(client, app_state, make_user, patch_models):
    """Settings lets the user switch provider and paste that provider's key in one
    go. Listing the *stored* provider's models there would be a plain lie."""
    calls = patch_models()
    _, alice = await _byok_user(make_user, provider="groq", model="llama-3.3-70b-versatile")

    r = await client.post(
        "/api/settings/ai/models", json={"provider": "anthropic", "api_key": "sk-ant-typed"}, headers=alice
    )

    assert r.status_code == 200
    assert r.json()["provider"] == "anthropic"
    # The stored Groq model must not ride along with an Anthropic key.
    assert calls == [("anthropic", "sk-ant-typed", None)]


async def test_stored_key_still_used_when_the_body_is_empty(client, app_state, make_user, patch_models):
    calls = patch_models()
    _, alice = await _byok_user(make_user)

    r = await client.post("/api/settings/ai/models", json={}, headers=alice)

    assert r.json()["key_source"] == "saved"
    assert calls == [("groq", "gsk_test_key", None)]


async def test_shared_key_is_reported_as_such(client, app_state, make_user, patch_models, monkeypatch):
    """"Your key works" and "the instance's shared key works" are different
    answers, and only one of them means the user is done."""
    from api.config import settings

    monkeypatch.setattr(settings, "SHARED_GEMINI_KEY", "shared-key")
    patch_models()
    _, alice = await make_user()  # no personal key

    r = await client.post("/api/settings/ai/models", json={}, headers=alice)

    assert r.status_code == 200, r.text
    assert r.json()["key_source"] == "shared"
    assert r.json()["provider"] == "gemini"


async def test_a_typed_key_for_an_unknown_provider_is_422(client, app_state, make_user, patch_models):
    calls = patch_models()
    _, alice = await _byok_user(make_user)

    r = await client.post(
        "/api/settings/ai/models", json={"provider": "not-a-provider", "api_key": "k"}, headers=alice
    )

    assert r.status_code == 422
    assert calls == []


async def test_typed_key_length_is_bounded(client, app_state, make_user, patch_models):
    calls = patch_models()
    _, alice = await _byok_user(make_user)

    r = await client.post("/api/settings/ai/models", json={"api_key": "x" * 501}, headers=alice)

    assert r.status_code == 422
    assert calls == []


async def test_typed_key_is_cached_under_its_own_hash(
    client, app_state, make_user, patch_models, redis_client
):
    """Two different keys must never share an answer — that is how a user would
    see the *old* key's catalogue after pasting a new one."""
    calls = patch_models()
    _, alice = await _byok_user(make_user)

    a = await client.post("/api/settings/ai/models", json={"api_key": "key-one"}, headers=alice)
    b = await client.post("/api/settings/ai/models", json={"api_key": "key-two"}, headers=alice)
    again = await client.post("/api/settings/ai/models", json={"api_key": "key-one"}, headers=alice)

    assert [a.json()["cached"], b.json()["cached"], again.json()["cached"]] == [False, False, True]
    assert len(calls) == 2
    keys = [k async for k in redis_client.scan_iter("ai_models:*")]
    assert len(keys) == 2


# --------------------------------------------------------------------------- #
# Rejected key vs broken provider
# --------------------------------------------------------------------------- #

async def test_a_rejected_key_is_400_not_502(client, app_state, make_user, patch_models):
    """This is the exact reported error. 502 would blame the provider for a key
    the user can fix in the field right above; the status is what tells the UI to
    say "this key was rejected" instead of "upstream error"."""
    from agent.errors import AuthError

    patch_models(exc=AuthError(
        "Error code: 401 - {'error': {'message': 'Invalid API Key', "
        "'type': 'invalid_request_error', 'code': 'expired_api_key'}}"
    ))
    _, alice = await _byok_user(make_user)

    r = await client.post("/api/settings/ai/models", json={"api_key": "gsk_expired"}, headers=alice)

    assert r.status_code == 400, r.text
    detail = r.json()["detail"]
    # The provider's own words, none of its wire format: "expired_api_key" tells
    # the user something "authentication failed" does not, while
    # "Error code: 401 - {'error': …}" is a debugging artifact in a UI.
    assert detail == "Invalid API Key (expired_api_key)"
    assert "{" not in detail and "Error code" not in detail


async def test_a_rejected_key_is_not_cached(client, app_state, make_user, patch_models, redis_client):
    """Caching a 400 would keep rejecting a key that has since been fixed."""
    from agent.errors import AuthError

    calls = patch_models(exc=AuthError("Invalid API Key"))
    _, alice = await _byok_user(make_user)

    for _ in range(2):
        r = await client.post("/api/settings/ai/models", json={"api_key": "bad"}, headers=alice)
        assert r.status_code == 400

    assert len(calls) == 2
    assert [k async for k in redis_client.scan_iter("ai_models:*")] == []


# --------------------------------------------------------------------------- #
# Ollama Cloud is an ordinary keyed provider
# --------------------------------------------------------------------------- #

async def test_ollama_is_selectable_with_no_instance_flag_involved(
    client, app_state, make_user, patch_models
):
    """There is no operator switch left. Ollama used to need one because the
    endpoint was a machine the *user* ran; it is a hosted API now, so it is
    accepted exactly like Groq — and an unknown name is still a 400 naming the
    valid set, so a typo does not read as policy."""
    patch_models()
    _, alice = await _byok_user(make_user)

    r = await client.patch(
        "/api/settings",
        json={"ai_provider": "ollama", "ai_api_key": "ollama-aaaa-bbbb-cccc"},
        headers=alice,
    )
    assert r.status_code == 200, r.text
    assert (await client.get("/api/settings", headers=alice)).json()["ai_provider"] == "ollama"

    r = await client.patch("/api/settings", json={"ai_provider": "llamafile"}, headers=alice)
    assert r.status_code == 400
    assert "must be one of" in r.text.lower()


async def test_the_ollama_key_is_masked_like_every_other_provider(
    client, app_state, make_user
):
    """It used to be returned in full, because it was a base URL — an address
    the user typed, not a secret, and masking it made the connected card
    unreadable ("http...1434"). A cloud key is a bearer token, so the exemption
    has to go with the self-hosted support that justified it.
    """
    _, alice = await _byok_user(make_user, provider="ollama")
    key = "ollama-aaaa-bbbb-cccc-dddd-3456"

    r = await client.patch(
        "/api/settings", json={"ai_provider": "ollama", "ai_api_key": key}, headers=alice
    )
    assert r.status_code == 200, r.text

    body = (await client.get("/api/settings", headers=alice)).text
    assert key not in body
    masked = json.loads(body)["ai_api_key_masked"]
    assert masked.startswith("olla") and masked.endswith("3456")
