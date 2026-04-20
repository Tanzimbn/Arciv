import uuid
from datetime import datetime

from pydantic import BaseModel


class LinkCreate(BaseModel):
    url: str


class LinkUpdate(BaseModel):
    queue: str | None = None
    content_type: str | None = None
    ai_tags: list[str] | None = None
    status: str | None = None


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
    saved_at: datetime
    done_at: datetime | None

    model_config = {"from_attributes": True}
