import httpx

from agent.base import AIProvider, AIResult
from agent.errors import ModelError, raise_mapped
from agent.prompt import (
    SYSTEM_PROMPT,
    build_user_message,
    parse_ai_response,
)
from api.config import settings
from api.utils.safe_fetch import UnsafeURLError, safe_request

# Ollama's hosted API. A constant, not a user-supplied address: self-hosted
# Ollama was dropped precisely because "the API key is a URL the worker then
# dials" is a shape no other provider has.
BASE_URL = "https://ollama.com"


def _status_error(response: httpx.Response) -> httpx.HTTPStatusError:
    """An HTTPStatusError carrying Ollama's body instead of httpx's blurb.

    ``raise_mapped`` classifies off ``response.status_code``, and
    ``human_message`` digs the sentence out of the exception message — so the
    body is what has to be in the message. ``raise_for_status()`` would put
    ``"Client error '401 Unauthorized' for url 'https://ollama.com/api/ps'"``
    there, and a URL is not something a user can act on; Ollama's own
    ``{"error": "unauthorized"}`` is.
    """
    body = response.text.strip()
    try:
        request = response.request
    except RuntimeError:  # response built without one (never in production)
        request = httpx.Request("GET", response.url)
    return httpx.HTTPStatusError(
        body or f"Ollama returned HTTP {response.status_code}.",
        request=request,
        response=response,
    )


class OllamaProvider(AIProvider):
    """Ollama Cloud — a normal BYOK provider, keyed like Groq.

    Speaks Ollama's native protocol (``/api/chat``, ``/api/tags``) against
    ``https://ollama.com`` with a bearer token from ``ollama.com/settings/keys``.
    The requests still go through ``safe_request``: the URL is a constant now, so
    this is no longer about SSRF, but every one of them carries the user's API
    key, and ``safe_fetch`` validates each redirect hop and drops
    ``Authorization`` when one crosses origins. One DNS resolve is a cheap price
    for a credential that cannot be redirected off-site.
    """

    DEFAULT_MODEL = "gpt-oss:120b"
    BASE_URL = BASE_URL

    def __init__(self, api_key: str, model: str | None = None):
        key = (api_key or "").strip()
        if any(ord(c) < 0x20 or ord(c) == 0x7F for c in key):
            # CRLF in a header value is request splitting. Rejected rather than
            # sanitised: a user who pasted one has a config error to fix, and
            # ModelError is permanent, so the link fails on the first attempt
            # instead of climbing the backoff ladder.
            raise ModelError("Ollama API key contains control characters.")
        # Always Bearer, never Basic. A key that happens to contain a colon is
        # still a key — reading it as ``user:pass`` would authenticate nothing
        # and surface as a rejected credential.
        self._headers = {"Authorization": f"Bearer {key}"} if key else {}
        self._model = model or self.DEFAULT_MODEL

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: dict | None = None,
        timeout: float,
    ) -> httpx.Response:
        try:
            response, _ = await safe_request(
                method,
                f"{BASE_URL}{path}",
                json=json_body,
                headers=self._headers,
                timeout=timeout,
            )
        except UnsafeURLError as e:
            # Only reachable if ollama.com itself resolves somewhere private
            # (a DNS hijack, or a self-hoster's /etc/hosts). Permanent.
            raise ModelError(f"Ollama endpoint not allowed: {e}") from e
        except Exception as e:
            raise_mapped(e)
        if response.status_code >= 400:
            raise_mapped(_status_error(response))
        return response

    async def _post_chat(self, payload: dict) -> str:
        response = await self._request(
            "POST",
            "/api/chat",
            json_body=payload,
            # Configurable because this one blocks a shared worker slot, and has
            # to stay well under WorkerSettings.job_timeout (120s): an arq
            # timeout kill cancels the coroutine, so no except branch would run
            # and the row would strand at ai_status="processing".
            timeout=float(settings.OLLAMA_TIMEOUT),
        )
        return response.json()["message"]["content"]

    async def classify_and_summarise(self, title: str, content: str, url: str) -> AIResult | None:
        text = await self._post_chat({
            "model": self._model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": build_user_message(title, content, url)},
            ],
            "stream": False,
            "format": "json",
        })
        return parse_ai_response(text)

    async def generate(self, system: str, user_message: str) -> str:
        return await self._post_chat({
            "model": self._model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user_message},
            ],
            "stream": False,
        })

    async def _check_credentials(self) -> None:
        """Reject a bad key before listing, because ``/api/tags`` will not.

        The other four providers get a credential check for free: their model
        catalogue is behind the key, so "list the models" answers "is this key
        valid?" at the same time. Ollama Cloud's catalogue is public —
        ``GET /api/tags`` returns all of it for a bogus key *and* for no key at
        all — so without this, Connect would report success on a typo, store it,
        and the user would find out hours later from a failed link.

        ``/api/ps`` (the running-models list) is the cheapest endpoint that is
        auth-gated: read-only, no tokens billed, 401 for an unusable key.

        Fails open on 404/405. This endpoint is not part of any documented
        contract, so if Ollama moves or retires it the cost of having guessed
        wrong must be "no pre-check" — a bad key then surfaces on the first
        classify, as it did before — and not "nobody can connect".
        """
        try:
            response, _ = await safe_request(
                "GET",
                f"{BASE_URL}/api/ps",
                headers=self._headers,
                timeout=float(settings.OLLAMA_LIST_TIMEOUT),
            )
        except UnsafeURLError as e:
            raise ModelError(f"Ollama endpoint not allowed: {e}") from e
        except Exception as e:
            raise_mapped(e)
        if response.status_code in (404, 405):
            return
        if response.status_code >= 400:
            raise_mapped(_status_error(response))

    async def list_models(self) -> list[str]:
        await self._check_credentials()
        response = await self._request(
            "GET", "/api/tags", timeout=float(settings.OLLAMA_LIST_TIMEOUT)
        )
        data = response.json()
        return sorted(m["name"] for m in data.get("models", []) if m.get("name"))
