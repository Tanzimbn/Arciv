from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class AIResult:
    content_type: str
    queue: str
    summary: str
    tags: list[str] = field(default_factory=list)
    raw_response: dict = field(default_factory=dict)


class AIProvider(ABC):
    #: Used when the user has not chosen a model (``users.ai_model`` is NULL).
    #: Providers retire models, so treat this as a default that will go stale —
    #: not a guarantee.
    DEFAULT_MODEL: str = ""

    @abstractmethod
    async def classify_and_summarise(self, title: str, content: str, url: str) -> AIResult | None:
        ...

    @abstractmethod
    async def generate(self, system: str, user_message: str) -> str:
        """Send a free-form system + user prompt, return raw text response."""
        ...

    @abstractmethod
    async def list_models(self) -> list[str]:
        """Model ids this key can use, from the provider's own catalogue.

        Filtered to models that can actually serve a chat completion — offering
        an embedding or speech model would only reproduce the failure this exists
        to prevent. Raises through ``raise_mapped``, so a rejected key surfaces
        as ``AuthError``.
        """
        ...
