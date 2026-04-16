from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str
    REDIS_URL: str = "redis://redis:6379/0"

    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 10080  # 7 days

    ENCRYPTION_KEY: str

    TELEGRAM_BOT_TOKEN: str = ""
    SHARED_GEMINI_KEY: str = ""
    FEED_POLL_CRON: str = "0 8 * * *"

    ENVIRONMENT: str = "development"


settings = Settings()
