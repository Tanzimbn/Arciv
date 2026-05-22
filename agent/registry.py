from agent.base import AIProvider

VALID_PROVIDERS = {"gemini", "groq", "anthropic", "openai", "ollama"}


def make_provider(provider: str, api_key: str) -> AIProvider:
    """Instantiate AI provider by name. api_key is base_url for ollama."""
    if provider == "gemini":
        from agent.providers.gemini import GeminiProvider
        return GeminiProvider(api_key)
    if provider == "groq":
        from agent.providers.groq_provider import GroqProvider
        return GroqProvider(api_key)
    if provider == "anthropic":
        from agent.providers.anthropic_provider import AnthropicProvider
        return AnthropicProvider(api_key)
    if provider == "openai":
        from agent.providers.openai_provider import OpenAIProvider
        return OpenAIProvider(api_key)
    if provider == "ollama":
        from agent.providers.ollama import OllamaProvider
        return OllamaProvider(base_url=api_key or "http://localhost:11434")
    # Unknown provider — fall back to gemini
    from agent.providers.gemini import GeminiProvider
    return GeminiProvider(api_key)
