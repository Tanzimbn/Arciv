from openai import AsyncOpenAI

from agent.base import AIProvider, AIResult
from agent.errors import raise_mapped
from agent.prompt import (
    SYSTEM_PROMPT,
    build_user_message,
    parse_ai_response,
)


class OpenAIProvider(AIProvider):
    DEFAULT_MODEL = "gpt-4o-mini"

    def __init__(self, api_key: str, model: str | None = None):
        self._client = AsyncOpenAI(api_key=api_key)
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

    # The raw list is mostly whisper / tts / dall-e / embedding / moderation
    # models. Offering those would guarantee the failure this endpoint exists to
    # prevent, so keep only the chat-completion families.
    _CHAT_PREFIXES = ("gpt", "o1", "o3", "o4", "chatgpt")
    # Some `gpt-*` ids are image, audio or realtime endpoints, not chat.
    _NOT_CHAT = ("image", "audio", "transcribe", "tts", "realtime", "search-preview")

    async def list_models(self) -> list[str]:
        try:
            response = await self._client.models.list()
        except Exception as e:
            raise_mapped(e)
        return sorted(
            m.id
            for m in response.data
            if getattr(m, "id", None)
            and m.id.lower().startswith(self._CHAT_PREFIXES)
            and not any(x in m.id.lower() for x in self._NOT_CHAT)
        )
