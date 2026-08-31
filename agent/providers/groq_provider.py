from groq import AsyncGroq

from agent.base import AIProvider, AIResult
from agent.errors import raise_mapped
from agent.prompt import (
    SYSTEM_PROMPT,
    build_user_message,
    parse_ai_response,
)


class GroqProvider(AIProvider):
    DEFAULT_MODEL = "llama-3.3-70b-versatile"

    def __init__(self, api_key: str, model: str | None = None):
        self._client = AsyncGroq(api_key=api_key)
        self._model = model or self.DEFAULT_MODEL

    async def classify_and_summarise(self, title: str, content: str, url: str) -> AIResult | None:
        try:
            response = await self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": build_user_message(title, content, url)},
                ],
                temperature=0.1,
                response_format={"type": "json_object"},
            )
            return parse_ai_response(response.choices[0].message.content)
        except Exception as e:
            raise_mapped(e)

    async def generate(self, system: str, user_message: str) -> str:
        try:
            response = await self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user_message},
                ],
                temperature=0.3,
            )
            return response.choices[0].message.content
        except Exception as e:
            raise_mapped(e)

    # Groq's catalogue mixes speech models in with the chat ones and the SDK's
    # model object carries no modality field, so exclude them by family. Only
    # families that cannot serve chat.completions at all are listed.
    _NOT_CHAT = ("whisper", "tts")

    async def list_models(self) -> list[str]:
        try:
            response = await self._client.models.list()
        except Exception as e:
            raise_mapped(e)
        return sorted(
            m.id
            for m in response.data
            if getattr(m, "id", None) and not any(x in m.id.lower() for x in self._NOT_CHAT)
        )
