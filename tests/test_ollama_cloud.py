"""Ollama Cloud provider — key handling, endpoint pinning, credential probe.

Ollama used to be the odd provider out: the "API key" was a base URL pointing at
the user's own server. It is now a hosted API keyed like Groq, and this file pins
the three things that changed and are not obvious from the code:

1. The key is always a **Bearer** token. The old provider read a colon as
   ``user:pass`` and sent Basic; a cloud key containing a colon must not be
   re-split, because Basic authenticates nothing here and the failure would look
   like a rejected key rather than a bug.
2. Requests go to ``https://ollama.com`` and nowhere else. The address is no
   longer user input, and nothing the user types may steer it.
3. ``list_models()`` probes ``GET /api/ps`` first. Ollama Cloud's catalogue is
   **public** — ``GET /api/tags`` answers 200 with all of it for a bogus key and
   for no key at all — so the invariant the other four providers give us for free
   ("listing is the credential check") does not hold, and without the probe the
   Connect flow would report success on a typo and store it.
"""
import httpx
import pytest

from agent.errors import AuthError, ModelError, QuotaError
from agent.providers.ollama import OllamaProvider
from api.utils import safe_fetch

PUBLIC_IP = "93.184.216.34"

TAGS_BODY = {"models": [{"name": "qwen3:8b"}, {"name": "gpt-oss:120b"}, {"name": ""}]}


@pytest.fixture
def resolver(monkeypatch):
    """Resolve every host to one public address.

    Patched so no test here can pass merely because DNS failed on the machine
    running it, and so ``ollama.com`` needs no real lookup.
    """

    async def _resolve(host):
        return [PUBLIC_IP]

    monkeypatch.setattr(safe_fetch, "_resolve", _resolve)


@pytest.fixture
def http(monkeypatch):
    """Answer outbound requests from a per-path routing table, recording each.

    Patches the same transport class as the ``no_network`` fixture, so nothing
    leaves the process. Routes on ``request.url.path`` because a single
    ``list_models()`` makes two requests to two paths and the test needs to give
    them different answers.
    """

    class FakeHTTP:
        def __init__(self):
            self.requests: list[httpx.Request] = []
            self.routes: dict[str, httpx.Response] = {}

        @property
        def paths(self) -> list[str]:
            return [r.url.path for r in self.requests]

        def last(self) -> httpx.Request:
            assert self.requests, "no outbound request was made"
            return self.requests[-1]

    fake = FakeHTTP()

    async def handle(transport_self, request):
        fake.requests.append(request)
        response = fake.routes.get(request.url.path)
        assert response is not None, f"unrouted request to {request.url.path}"
        return response

    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", handle)
    return fake


def _json(status: int, payload: dict) -> httpx.Response:
    return httpx.Response(status, json=payload)


def _chat(text: str) -> httpx.Response:
    return _json(200, {"message": {"content": text}})


# --------------------------------------------------------------------------- #
# 1. The key
# --------------------------------------------------------------------------- #

def test_key_is_always_bearer_even_with_a_colon():
    """A hosted API key is one opaque string. The old provider split on the
    first colon and sent Basic, which for ollama.com would send credentials no
    endpoint accepts — and the 401 would read as "your key is wrong"."""
    assert OllamaProvider("abc:def")._headers == {"Authorization": "Bearer abc:def"}
    assert OllamaProvider("plain")._headers == {"Authorization": "Bearer plain"}


@pytest.mark.parametrize("key", ["", "   ", "\t", None])
def test_blank_key_sends_no_header(key):
    """Blank must mean "no header", never ``Bearer `` with an empty value: an
    empty bearer is a malformed request, and the 400 it earns is not the 401
    that tells the user their key is missing."""
    assert OllamaProvider(key)._headers == {}


def test_surrounding_whitespace_is_stripped():
    """Pasting from a browser brings a trailing newline more often than not."""
    assert OllamaProvider("  k3y\n")._headers == {"Authorization": "Bearer k3y"}


@pytest.mark.parametrize("key", ["a\r\nX-Evil: 1", "a\nb", "a\x00b", "a\x7fb"])
def test_control_characters_are_rejected_at_construction(key):
    """CRLF in a header value is request splitting. Raised before any outbound
    request, and ``ModelError`` is permanent, so the link fails on the first
    attempt instead of climbing the backoff ladder.

    The schema validator catches this at the API boundary; this is the backstop
    for the worker path, where the value comes out of the database."""
    with pytest.raises(ModelError, match="control characters"):
        OllamaProvider(key)


def test_default_model_is_used_when_none_is_chosen():
    """``users.ai_model`` being NULL encodes "the provider's default"."""
    assert OllamaProvider("k")._model == OllamaProvider.DEFAULT_MODEL
    assert OllamaProvider("k", "qwen3:8b")._model == "qwen3:8b"


# --------------------------------------------------------------------------- #
# 2. The endpoint
# --------------------------------------------------------------------------- #

async def test_requests_go_to_ollama_com(resolver, http):
    """The base URL is a module constant now. Nothing the user supplies — key or
    model — may influence which host is dialled.

    ``safe_request`` pins the connection to the address it validated, so the URL
    host is that address and the real name travels in ``Host`` (and TLS SNI).
    Asserting the header, not the URL, is what makes this test about the
    destination rather than about the pinning.
    """
    http.routes["/api/chat"] = _chat('{"content_type":"article","queue":"read-later"}')
    await OllamaProvider("k", "http://evil.test/#").classify_and_summarise("t", "c", "u")
    request = http.last()
    assert request.headers["host"] == "ollama.com"
    assert request.url.host == PUBLIC_IP  # pinned
    assert request.url.scheme == "https"
    assert request.url.path == "/api/chat"


async def test_the_key_is_sent_on_both_the_probe_and_the_listing(resolver, http):
    http.routes["/api/ps"] = _json(200, {"models": []})
    http.routes["/api/tags"] = _json(200, TAGS_BODY)
    await OllamaProvider("k3y").list_models()
    assert http.paths == ["/api/ps", "/api/tags"]
    for request in http.requests:
        assert request.headers["authorization"] == "Bearer k3y"


async def test_chat_body_asks_for_json_and_no_streaming(resolver, http):
    """``stream: false`` because the caller wants one string, and ``format:
    "json"`` because ``parse_ai_response`` does a bare ``json.loads``."""
    import json as _json_mod

    http.routes["/api/chat"] = _chat('{"content_type":"video","queue":"watch-later"}')
    result = await OllamaProvider("k", "qwen3:8b").classify_and_summarise("t", "c", "u")
    body = _json_mod.loads(http.last().content)
    assert body["model"] == "qwen3:8b"
    assert body["stream"] is False
    assert body["format"] == "json"
    assert [m["role"] for m in body["messages"]] == ["system", "user"]
    assert result.content_type == "video"
    assert result.queue == "watch-later"


# --------------------------------------------------------------------------- #
# 3. The credential probe
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("status", [401, 403])
async def test_a_rejected_key_is_an_auth_error_carrying_ollamas_own_words(
    status, resolver, http
):
    """The whole reason the probe exists: ``/api/tags`` would have answered 200.

    ``AuthError`` is what the ``/settings/ai/models`` route turns into a 400
    naming the key field, and the message has to be Ollama's own sentence —
    ``raise_for_status()`` would put ``"Client error '401 Unauthorized' for url
    …"`` there instead, and a URL is not something a user can act on.
    """
    http.routes["/api/ps"] = httpx.Response(status, json={"error": "unauthorized"})
    with pytest.raises(AuthError, match="unauthorized"):
        await OllamaProvider("bogus").list_models()
    # And the catalogue was never asked for, so a bad key cannot look like a
    # success with a populated model list behind it.
    assert http.paths == ["/api/ps"]


@pytest.mark.parametrize("status", [404, 405])
async def test_the_probe_fails_open_when_the_endpoint_moves(status, resolver, http):
    """``/api/ps`` is not part of any documented contract. If Ollama retires it,
    the cost of having guessed wrong must be "no pre-check" — a bad key then
    surfaces on the first classify, as it did before — and not "nobody can
    connect"."""
    http.routes["/api/ps"] = httpx.Response(status, text="not found")
    http.routes["/api/tags"] = _json(200, TAGS_BODY)
    assert await OllamaProvider("k").list_models() == ["gpt-oss:120b", "qwen3:8b"]


async def test_a_quota_error_from_the_probe_stays_a_quota_error(resolver, http):
    """429 must not be flattened into "bad key": the fix is waiting, not
    retyping. ``raise_mapped`` reads the status off the response, which is why
    the response stays attached to the error the provider raises."""
    http.routes["/api/ps"] = httpx.Response(429, json={"error": "rate limited"})
    with pytest.raises(QuotaError):
        await OllamaProvider("k").list_models()


async def test_a_transient_failure_is_not_swallowed(resolver, http):
    """A 5xx is upstream's problem, so it must stay transient — neither
    ``AuthError`` nor ``ModelError``, both of which are terminal and would fail
    the link on the first attempt."""
    http.routes["/api/ps"] = httpx.Response(503, text="upstream down")
    with pytest.raises(Exception) as excinfo:
        await OllamaProvider("k").list_models()
    assert not isinstance(excinfo.value, (AuthError, ModelError, QuotaError))


# --------------------------------------------------------------------------- #
# 4. The listing
# --------------------------------------------------------------------------- #

async def test_models_are_sorted_and_nameless_entries_dropped(resolver, http):
    http.routes["/api/ps"] = _json(200, {"models": []})
    http.routes["/api/tags"] = _json(200, TAGS_BODY)
    assert await OllamaProvider("k").list_models() == ["gpt-oss:120b", "qwen3:8b"]


async def test_an_empty_catalogue_is_an_empty_list_not_an_error(resolver, http):
    """A key with no models reachable is a real state the UI renders; it is not
    a failure to report as one."""
    http.routes["/api/ps"] = _json(200, {"models": []})
    http.routes["/api/tags"] = _json(200, {})
    assert await OllamaProvider("k").list_models() == []


async def test_a_bad_model_on_chat_is_permanent(resolver, http):
    """On a fixed endpoint the model name is the only user-controlled part of
    the request, so 404 means the config is wrong — ``ModelError``, which sets
    ``links.ai_error_kind = "config"`` and skips the backoff ladder."""
    http.routes["/api/chat"] = httpx.Response(404, json={"error": "model not found"})
    with pytest.raises(ModelError, match="model not found"):
        await OllamaProvider("k", "nope:1b").classify_and_summarise("t", "c", "u")
