import asyncio

import google.generativeai as genai

from agent.base import AIProvider, AIResult
from agent.errors import raise_mapped
from agent.prompt import build_combined_prompt, parse_ai_response


class GeminiProvider(AIProvider):
    DEFAULT_MODEL = "gemini-2.0-flash"

    def __init__(self, api_key: str, model: str | None = None):
        genai.configure(api_key=api_key)
        self._model_name = model or self.DEFAULT_MODEL
        self._model = genai.GenerativeModel(self._model_name)

    async def classify_and_summarise(self, title: str, content: str, url: str) -> AIResult | None:
        prompt = build_combined_prompt(title, content, url)
        try:
            response = await self._model.generate_content_async(prompt)
            return parse_ai_response(response.text)
        except Exception as e:
            raise_mapped(e)

    async def generate(self, system: str, user_message: str) -> str:
        try:
            response = await self._model.generate_content_async(f"{system}\n\n{user_message}")
            return response.text
        except Exception as e:
            raise_mapped(e)

    async def list_models(self) -> list[str]:
        # `genai.list_models` is sync and does network I/O, so it cannot run on
        # the event loop. It also returns embedding and legacy models, hence the
        # `generateContent` check.
        try:
            models = await asyncio.to_thread(lambda: list(genai.list_models()))
        except Exception as e:
            raise_mapped(e)
        return sorted(
            m.name.removeprefix("models/")
            for m in models
            if "generateContent" in getattr(m, "supported_generation_methods", ())
        )
