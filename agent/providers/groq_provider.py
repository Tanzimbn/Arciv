from groq import AsyncGroq

from agent.base import AIProvider, AIResult
from agent.prompt import (
    AuthError,
    ParseError,
    QuotaError,
    SYSTEM_PROMPT,
    build_user_message,
    parse_ai_response,
)


class GroqProvider(AIProvider):
    def __init__(self, api_key: str, model: str = "llama-3.1-8b-instant"):
        self._client = AsyncGroq(api_key=api_key)
        self._model = model

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
            msg = str(e)
            if "401" in msg or "invalid_api_key" in msg.lower():
                raise AuthError(msg) from e
            if "429" in msg or "rate_limit" in msg.lower():
                raise QuotaError(msg) from e
            if isinstance(e, ParseError):
                raise
            raise

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
            msg = str(e)
            if "401" in msg or "invalid_api_key" in msg.lower():
                raise AuthError(msg) from e
            if "429" in msg or "rate_limit" in msg.lower():
                raise QuotaError(msg) from e
            raise
