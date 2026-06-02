from pydantic import BaseModel


class SettingsResponse(BaseModel):
    username: str | None
    ai_provider: str
    ai_api_key_masked: str | None
    feed_notify_telegram: bool
    feed_notify_inapp: bool
    telegram_enabled: bool

    model_config = {"from_attributes": True}


class SettingsUpdate(BaseModel):
    username: str | None = None
    ai_provider: str | None = None
    ai_api_key: str | None = None
    feed_notify_telegram: bool | None = None
    feed_notify_inapp: bool | None = None


class AITestResult(BaseModel):
    success: bool
    message: str
    provider: str
