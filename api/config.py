from urllib.parse import parse_qs, urlsplit, urlunsplit

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str
    REDIS_URL: str = "redis://redis:6379/0"

    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    VERIFY_TOKEN_TTL_HOURS: int = 24
    RESET_TOKEN_TTL_HOURS: int = 1

    ENCRYPTION_KEY: str

    # Email / SMTP. When EMAIL_ENABLED is false, links are logged instead of sent
    # (local dev without an SMTP server).
    EMAIL_ENABLED: bool = False
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "Arciv <no-reply@arciv.local>"
    SMTP_STARTTLS: bool = True
    # Gmail API (HTTPS) backend. Use this when the host blocks outbound SMTP
    # ports (e.g. Render's free/starter tier blocks 25/465/587). When
    # GMAIL_REFRESH_TOKEN is set, email is sent via the Gmail REST API over
    # port 443 instead of SMTP — from the authenticated Gmail account. The
    # From display name still comes from SMTP_FROM.
    GMAIL_CLIENT_ID: str = ""
    GMAIL_CLIENT_SECRET: str = ""
    GMAIL_REFRESH_TOKEN: str = ""
    # Public base URL of this deployment, used to build verification / reset
    # links inside worker email jobs (which have no HTTP request to derive it
    # from). Dev default below; production MUST override, e.g.
    # APP_BASE_URL=https://arciv.example.com
    APP_BASE_URL: str = "http://localhost:8000"

    # Comma-separated browser origins allowed by CORS. APP_BASE_URL is always
    # appended automatically, so prod usually needs nothing extra here.
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:8000"

    TELEGRAM_ENABLED: bool = False
    TELEGRAM_BOT_TOKEN: str = ""
    SHARED_GEMINI_KEY: str = ""
    FEED_POLL_CRON: str = "0 8 * * *"

    # Local semantic-search embeddings (fastembed, ONNX, runs in-container — no
    # API key). Disable on very low-RAM hosts; saves still work, /links/search
    # returns 503 and the UI falls back to substring filtering.
    EMBEDDINGS_ENABLED: bool = True
    # Changing the model usually changes the vector dimension, which is baked
    # into migration 0012 (Vector(384)). A different-dim model needs a new
    # migration — keep this in sync with the column.
    EMBEDDING_MODEL: str = "BAAI/bge-small-en-v1.5"

    USER_AGENT: str = "Arciv/0.1 (+https://github.com/tanzimbn/arciv)"

    # Public-launch abuse/DoS guards. All default to "off" (0 / False) so
    # self-hosting stays unrestricted; a hosted deployment sets real ceilings.
    # Per-user rate limits (fixed-window Redis counters keyed by user_id):
    LINKS_CREATE_PER_HOUR: int = 30   # POST /api/links
    SEARCH_PER_MINUTE: int = 30       # GET /api/links/search (each call embeds q)
    INSIGHTS_PER_HOUR: int = 20       # POST /api/links/:id/insights (LLM call)
    # Per-user resource quotas (0 = unlimited):
    MAX_LINKS_PER_USER: int = 0
    MAX_FEEDS_PER_USER: int = 0
    # Registration-abuse controls:
    BLOCK_DISPOSABLE_EMAILS: bool = False  # reject known throwaway email domains
    SIGNUPS_PER_DAY_GLOBAL: int = 0        # 0 = unlimited; global daily signup ceiling

    ENVIRONMENT: str = "development"

    # Comma-separated emails granted admin access (user management). Empty = no admins.
    ADMIN_EMAILS: str = ""

    @property
    def cors_origins_list(self) -> list[str]:
        origins = {o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()}
        origins.add(self.APP_BASE_URL.rstrip("/"))
        return sorted(origins)

    @property
    def admin_emails_set(self) -> set[str]:
        return {e.strip().lower() for e in self.ADMIN_EMAILS.split(",") if e.strip()}

    def is_admin(self, email: str) -> bool:
        return email.lower() in self.admin_emails_set

    @property
    def async_database_url(self) -> str:
        """asyncpg connection URL. Strips libpq-only query params
        (``sslmode``, ``channel_binding``) that managed Postgres providers like
        Neon append by default — asyncpg can't parse them and raises on connect.
        TLS is instead enabled via ``db_connect_args``."""
        raw = self.DATABASE_URL
        for prefix in ("postgresql+asyncpg://", "postgres://", "postgresql://"):
            if raw.startswith(prefix):
                raw = "postgresql://" + raw[len(prefix):]
                break
        parts = urlsplit(raw)
        return urlunsplit(("postgresql+asyncpg", parts.netloc, parts.path, "", ""))

    @property
    def db_connect_args(self) -> dict:
        """TLS for managed Postgres (Neon) without breaking local docker
        Postgres. Decided by the raw URL's ``sslmode``."""
        sslmode = parse_qs(urlsplit(self.DATABASE_URL).query).get("sslmode", [""])[0].lower()
        return {"ssl": True} if sslmode not in ("", "disable", "allow") else {}


settings = Settings()
