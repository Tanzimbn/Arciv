import uuid
from datetime import datetime

from pydantic import BaseModel


class FeedDiscoverRequest(BaseModel):
    url: str


class FeedDiscoverResponse(BaseModel):
    feed_url: str
    title: str
    item_count: int
    favicon_url: str | None


class FeedCreate(BaseModel):
    site_url: str
    feed_url: str
    title: str
    favicon_url: str | None = None


class FeedUpdate(BaseModel):
    status: str | None = None  # active | paused


class FeedResponse(BaseModel):
    id: uuid.UUID
    site_url: str
    feed_url: str
    title: str | None
    favicon_url: str | None
    status: str
    last_checked_at: datetime | None
    consecutive_failures: int
    total_items_received: int
    created_at: datetime

    model_config = {"from_attributes": True}
