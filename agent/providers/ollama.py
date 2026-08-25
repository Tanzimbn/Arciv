import httpx

from agent.base import AIProvider, AIResult
from agent.errors import ModelError, raise_mapped
from agent.prompt import (
    SYSTEM_PROMPT,
    build_user_message,
    parse_ai_response,
)
from api.utils.safe_fetch import UnsafeURLError, safe_request


class OllamaProvider(AIProvider):
    """Ollama over HTTP, at a base URL the *user* supplies.

    That last part is why every request here goes through ``safe_request``:
    ``make_provider("ollama", api_key)`` passes the user's stored key in as the
    base URL, so on a hosted instance any signed-up account could otherwise aim
    the worker at an internal address — and ``list_models`` returns the parsed
    response to the caller, which would make it a read primitive rather than a
    blind one. Self-hosters running Ollama on the same box set
    ``ALLOW_PRIVATE_NETWORK_FETCH=true``, which is exactly what that switch is
    for.
    """

    DEFAULT_MODEL = "llama3"

    def __init__(self, base_url: str = "http://localhost:11434", model: str | None = None):
        self._base_url = base_url.rstrip("/")
        self._model = model or self.DEFAULT_MODEL

    async def _post_chat(self, payload: dict) -> str:
        try:
            response, _ = await safe_request(
                "POST", f"{self._base_url}/api/chat", json=payload, timeout=60.0
            )
            response.raise_for_status()
            return response.json()["message"]["content"]
        except UnsafeURLError as e:
            # Permanent and user-fixable: the base URL itself is not allowed.
            raise ModelError(f"Ollama base URL not allowed: {e}") from e
        except httpx.ConnectError as e:
            raise ConnectionError(f"Ollama unreachable at {self._base_url}: {e}") from e
        except Exception as e:
            raise_mapped(e)

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

    async def list_models(self) -> list[str]:
        try:
            response, _ = await safe_request(
                "GET", f"{self._base_url}/api/tags", timeout=15.0
            )
            response.raise_for_status()
            data = response.json()
        except UnsafeURLError as e:
            raise ModelError(f"Ollama base URL not allowed: {e}") from e
        except httpx.ConnectError as e:
            raise ConnectionError(f"Ollama unreachable at {self._base_url}: {e}") from e
        except Exception as e:
            raise_mapped(e)
        return sorted(m["name"] for m in data.get("models", []) if m.get("name"))
