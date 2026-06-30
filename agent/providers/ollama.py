import httpx

from agent.base import AIProvider, AIResult
from agent.prompt import (
    AuthError,
    ParseError,
    QuotaError,
    SYSTEM_PROMPT,
    build_user_message,
    parse_ai_response,
)


class OllamaProvider(AIProvider):
    def __init__(self, base_url: str = "http://localhost:11434", model: str = "llama3"):
        self._base_url = base_url.rstrip("/")
        self._model = model

    async def classify_and_summarise(self, title: str, content: str, url: str) -> AIResult | None:
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": build_user_message(title, content, url)},
            ],
            "stream": False,
            "format": "json",
        }
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(f"{self._base_url}/api/chat", json=payload)
                resp.raise_for_status()
                data = resp.json()
                text = data["message"]["content"]
                return parse_ai_response(text)
        except httpx.ConnectError as e:
            raise ConnectionError(f"Ollama unreachable at {self._base_url}: {e}") from e
        except httpx.HTTPStatusError as e:
            msg = str(e)
            if isinstance(e, ParseError):
                raise
            raise RuntimeError(msg) from e

    async def generate(self, system: str, user_message: str) -> str:
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user_message},
            ],
            "stream": False,
        }
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(f"{self._base_url}/api/chat", json=payload)
                resp.raise_for_status()
                return resp.json()["message"]["content"]
        except httpx.ConnectError as e:
            raise ConnectionError(f"Ollama unreachable at {self._base_url}: {e}") from e
        except httpx.HTTPStatusError as e:
            raise RuntimeError(str(e)) from e
