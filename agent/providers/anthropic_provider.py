from anthropic import AsyncAnthropic

from agent.base import AIProvider, AIResult
from agent.errors import raise_mapped
from agent.prompt import (
    SYSTEM_PROMPT,
    build_user_message,
    parse_ai_response,
)


class AnthropicProvider(AIProvider):
    DEFAULT_MODEL = "claude-haiku-4-5-20251001"

    def __init__(self, api_key: str, model: str | None = None):
        self._client = AsyncAnthropic(api_key=api_key)
        self._model = model or self.DEFAULT_MODEL

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
            raise_mapped(e)

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
            raise_mapped(e)

    async def list_models(self) -> list[str]:
        # Anthropic only publishes text models, so no filtering is needed.
        try:
            response = await self._client.models.list()
        except Exception as e:
            raise_mapped(e)
        return sorted((m.id for m in response.data if getattr(m, "id", None)), reverse=True)
