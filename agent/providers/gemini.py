import google.generativeai as genai

from agent.base import AIProvider, AIResult
from agent.prompt import AuthError, ParseError, QuotaError, build_combined_prompt, parse_ai_response


class GeminiProvider(AIProvider):
    def __init__(self, api_key: str, model: str = "gemini-1.5-flash"):
        genai.configure(api_key=api_key)
        self._model = genai.GenerativeModel(model)

    async def classify_and_summarise(self, title: str, content: str, url: str) -> AIResult | None:
        prompt = build_combined_prompt(title, content, url)
        try:
            response = await self._model.generate_content_async(prompt)
            return parse_ai_response(response.text)
        except Exception as e:
            msg = str(e)
            if "API_KEY_INVALID" in msg or "401" in msg or "403" in msg:
                raise AuthError(msg) from e
            if "429" in msg or "quota" in msg.lower():
                raise QuotaError(msg) from e
            if isinstance(e, ParseError):
                raise
            raise
