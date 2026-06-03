from anthropic import AsyncAnthropic

from agent.base import AIProvider, AIResult
from agent.prompt import (
    AuthError,
    ParseError,
    QuotaError,
    SYSTEM_PROMPT,
    build_user_message,
    parse_ai_response,
)


class AnthropicProvider(AIProvider):
    def __init__(self, api_key: str, model: str = "claude-haiku-4-5-20251001"):
        self._client = AsyncAnthropic(api_key=api_key)
        self._model = model

    async def classify_and_summarise(self, title: str, content: str, url: str) -> AIResult | None:
        try:
            response = await self._client.messages.create(
                model=self._model,
                max_tokens=512,
                system=SYSTEM_PROMPT,
                messages=[
                    {"role": "user", "content": build_user_message(title, content, url)},
                ],
            )
            return parse_ai_response(response.content[0].text)
        except Exception as e:
            msg = str(e)
            if "401" in msg or "authentication" in msg.lower():
                raise AuthError(msg) from e
            if "429" in msg or "rate_limit" in msg.lower() or "overloaded" in msg.lower():
                raise QuotaError(msg) from e
            if isinstance(e, ParseError):
                raise
            raise

    async def generate(self, system: str, user_message: str) -> str:
        try:
            response = await self._client.messages.create(
                model=self._model,
                max_tokens=1024,
                system=system,
                messages=[{"role": "user", "content": user_message}],
            )
            return response.content[0].text
        except Exception as e:
            msg = str(e)
            if "401" in msg or "authentication" in msg.lower():
                raise AuthError(msg) from e
            if "429" in msg or "rate_limit" in msg.lower() or "overloaded" in msg.lower():
                raise QuotaError(msg) from e
            raise
