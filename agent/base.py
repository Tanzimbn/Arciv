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
    @abstractmethod
    async def classify_and_summarise(self, title: str, content: str, url: str) -> AIResult | None:
        ...
