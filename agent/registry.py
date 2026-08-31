from agent.base import AIProvider

# Every name this build knows how to instantiate. All five are plain BYOK
# providers — one API key each, no per-instance switches.
VALID_PROVIDERS = {"gemini", "groq", "anthropic", "openai", "ollama"}


def make_provider(provider: str, api_key: str, model: str | None = None) -> AIProvider:
    """Instantiate AI provider by name.

    ``model`` of ``None`` means "use the provider's ``DEFAULT_MODEL``" — that is
    what ``users.ai_model`` being NULL encodes.

    An unknown name raises instead of quietly returning Gemini: silently calling
    a different provider than the one configured turns a typo into a confusing
    wrong-credentials failure.
    """
    if provider == "gemini":
        from agent.providers.gemini import GeminiProvider
        return GeminiProvider(api_key, model)
    if provider == "groq":
        from agent.providers.groq_provider import GroqProvider
        return GroqProvider(api_key, model)
    if provider == "anthropic":
        from agent.providers.anthropic_provider import AnthropicProvider
        return AnthropicProvider(api_key, model)
    if provider == "openai":
        from agent.providers.openai_provider import OpenAIProvider
        return OpenAIProvider(api_key, model)
    if provider == "ollama":
        from agent.providers.ollama import OllamaProvider
        return OllamaProvider(api_key, model)
    raise ValueError(f"Unknown AI provider: {provider!r}")


def default_model_for(provider: str) -> str:
    """The model used when the user has picked none. Empty for an unknown name."""
    if provider == "gemini":
        from agent.providers.gemini import GeminiProvider
        return GeminiProvider.DEFAULT_MODEL
    if provider == "groq":
        from agent.providers.groq_provider import GroqProvider
        return GroqProvider.DEFAULT_MODEL
    if provider == "anthropic":
        from agent.providers.anthropic_provider import AnthropicProvider
        return AnthropicProvider.DEFAULT_MODEL
    if provider == "openai":
        from agent.providers.openai_provider import OpenAIProvider
        return OpenAIProvider.DEFAULT_MODEL
    if provider == "ollama":
        from agent.providers.ollama import OllamaProvider
        return OllamaProvider.DEFAULT_MODEL
    return ""
