import uuid
from datetime import datetime

from pydantic import BaseModel


class TelegramLinkResponse(BaseModel):
    token: str
    expires_at: datetime


class DailyDigestItem(BaseModel):
    title: str
    feed_name: str
    url: str


class DailyDigestResponse(BaseModel):
    items: list[DailyDigestItem]
