import uuid
from datetime import datetime

from pydantic import BaseModel, field_validator

VALID_QUEUES = {"watch-later", "read-later", "try-later", "inbox"}
VALID_CONTENT_TYPES = {
    "article", "video", "tool", "research-paper",
    "newsletter", "podcast", "other",
}


class LinkCreate(BaseModel):
    url: str


class LinkUpdate(BaseModel):
    queue: str | None = None
    content_type: str | None = None
    ai_tags: list[str] | None = None
    status: str | None = None
    notes: str | None = None

    @field_validator("queue")
    @classmethod
    def validate_queue(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_QUEUES:
            raise ValueError(f"queue must be one of {sorted(VALID_QUEUES)}")
        return v

    @field_validator("content_type")
    @classmethod
    def validate_content_type(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_CONTENT_TYPES:
            raise ValueError(f"content_type must be one of {sorted(VALID_CONTENT_TYPES)}")
        return v

    @field_validator("ai_tags")
    @classmethod
    def validate_tags(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        if len(v) > 20:
            raise ValueError("maximum 20 tags allowed")
        for tag in v:
            if not tag or not tag.strip():
                raise ValueError("tags must not be empty")
            if len(tag) > 50:
                raise ValueError("each tag must be 50 characters or fewer")
        # Deduplicate preserving order, case-insensitive
        seen: set[str] = set()
        deduped: list[str] = []
        for tag in v:
            key = tag.strip().lower()
            if key not in seen:
                seen.add(key)
                deduped.append(tag.strip())
        return deduped

    @field_validator("notes")
    @classmethod
    def validate_notes(cls, v: str | None) -> str | None:
        if v is not None and len(v) > 10_000:
            raise ValueError("notes must be 10,000 characters or fewer")
        return v

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str | None) -> str | None:
        if v is not None and v not in {"active", "done"}:
            raise ValueError("status must be 'active' or 'done'")
        return v


class LinkResponse(BaseModel):
    id: uuid.UUID
    url: str
    canonical_url: str
    title: str | None
    description: str | None
    favicon_url: str | None
    content_type: str | None
    queue: str
    ai_summary: str | None
    ai_tags: list[str] | None
    ai_status: str
    status: str
    fetch_status: str
    notes: str | None
    ai_insights: list[str] | None
    saved_at: datetime
    done_at: datetime | None

    model_config = {"from_attributes": True}
