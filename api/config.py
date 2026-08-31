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
    # Envelope encryption: the active KEK is ENCRYPTION_KEY, labelled by
    # ENCRYPTION_KEY_ID (embedded in every new blob). To rotate, promote a new
    # secret to ENCRYPTION_KEY with a fresh id, move the old one into
    # ENCRYPTION_KEYS_RETIRED ("id:secret,id:secret") so existing blobs still
    # decrypt, then run scripts/rotate_encryption_key.py to re-wrap under the
    # new KEK. Retired keys can be dropped once rotation completes.
    ENCRYPTION_KEY_ID: str = "1"
    ENCRYPTION_KEYS_RETIRED: str = ""

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
    # Cap on simultaneous in-process embeddings (fastembed is CPU-bound: even
    # though inference runs off the event loop, N parallel embeds saturate every
    # core and starve request handling). Keep this <= cores-1 so the event-loop
    # thread always has a core. Applies per process, so it globally bounds embed
    # load on a single-box deploy (api + worker each get their own cap). Raise it
    # on a bigger host. Applies only in local mode; when EMBED_SERVICE_URL is set
    # the embed service enforces its own concurrency cap instead.
    EMBEDDING_MAX_CONCURRENCY: int = 2
    # Cache search-query vectors in Redis so repeated/identical searches skip the
    # CPU embed entirely. TTL in seconds; 0 disables the cache.
    SEARCH_EMBED_CACHE_TTL: int = 180
    # When set (e.g. http://embed:8001), embed_text() calls this dedicated
    # embedding microservice over HTTP instead of loading the ONNX model
    # in-process. Lets the api + worker shed the model (~400MB each) so they fit
    # low-RAM hosts; the model then lives in ONE place. Empty (default) = local
    # in-process model — unchanged single-container behavior.
    EMBED_SERVICE_URL: str = ""

    USER_AGENT: str = "Arciv/0.1 (+https://github.com/tanzimbn/arciv)"

    # Outbound-fetch safety (api/utils/safe_fetch.py). Every URL this app fetches
    # comes from a user, and the containers can reach Postgres, Redis, the embed
    # service and the cloud instance-metadata endpoint.
    # KEEP THIS FALSE on anything reachable from the public internet: true lets any
    # signed-up user use the fetchers to read your private network, and
    # fetch_article_text returns the response body to them.
    # Self-hosters who genuinely want to save links from their own LAN can set it.
    ALLOW_PRIVATE_NETWORK_FETCH: bool = False
    # Redirect hops allowed per fetch. Every hop is re-validated and re-pinned, so
    # this bounds work, not safety.
    MAX_FETCH_REDIRECTS: int = 5

    # Public-launch abuse/DoS guards. All default to "off" (0 / False) so
    # self-hosting stays unrestricted; a hosted deployment sets real ceilings.
    # Per-user rate limits (fixed-window Redis counters keyed by user_id).
    # These are burst/anti-spam guards, NOT usage caps: AI is BYO-key, so the
    # per-call cost falls on the user, not the operator. The only thing worth
    # protecting is the server (outbound fetches, request workers, queue depth),
    # so limits are per-MINUTE — high enough that no human hits them, low enough
    # to stop a script hammering the box.
    LINKS_CREATE_PER_MINUTE: int = 20  # POST /api/links (metadata fetch + enqueue)
    SEARCH_PER_MINUTE: int = 30  # GET /api/links/search (each call embeds q)
    INSIGHTS_PER_MINUTE: int = 10  # POST /api/links/:id/insights (inline LLM call)
    # POST /api/feeds/discover — fetches the page plus up to 5 COMMON_PATHS probes,
    # so one call is several outbound requests. Lowest limit of the set.
    FEEDS_DISCOVER_PER_MINUTE: int = 10
    # GET /api/settings/ai/models — one call to the user's AI provider. Low
    # because the UI needs it once per Settings visit and the answer is cached.
    AI_MODELS_PER_MINUTE: int = 6
    # How long a provider's model list stays cached, per (provider, key hash).
    # Model catalogues change on the order of weeks; an hour keeps Settings snappy
    # without pinning a stale list past a user rotating their key. 0 = no cache.
    AI_MODELS_CACHE_TTL: int = 3600

    # --- Ollama Cloud ---
    # Chat/list timeouts, seconds. Ollama is the one provider we call over plain
    # HTTP rather than through an SDK, so the timeout is ours to set. Keep both
    # well under WorkerSettings.job_timeout (120): an arq timeout kill cancels
    # the coroutine and runs none of the error handling, which strands the link
    # at ai_status="processing".
    OLLAMA_TIMEOUT: int = 60
    OLLAMA_LIST_TIMEOUT: int = 15
    # Links requeued per sweep_failed_links run, and per user within one run
    # (0 = unlimited). The sweep resets ai_attempt_count, so an unbounded sweep
    # lets one broken provider dump thousands of jobs onto the same queue that
    # carries signup email.
    SWEEP_BATCH_LIMIT: int = 200
    SWEEP_PER_USER_LIMIT: int = 20
    # Auth-route rate limits (per client IP). slowapi rate strings, e.g. "5/minute",
    # "20/hour". Guard against credential stuffing / signup + email-send abuse.
    AUTH_REGISTER_RATE_LIMIT: str = "20/hour"
    AUTH_LOGIN_RATE_LIMIT: str = "5/minute"
    AUTH_VERIFY_EMAIL_RATE_LIMIT: str = "10/hour"
    AUTH_RESEND_VERIFICATION_RATE_LIMIT: str = "3/hour"
    AUTH_FORGOT_PASSWORD_RATE_LIMIT: str = "3/hour"
    AUTH_RESET_PASSWORD_RATE_LIMIT: str = "10/hour"
    # Per-user resource quotas (0 = unlimited):
    MAX_LINKS_PER_USER: int = 0
    MAX_FEEDS_PER_USER: int = 0
    # Approx bytes of persisted content a user may accumulate (0 = unlimited).
    # Maintained as a running total on users.storage_bytes; enforced (soft) at
    # link-create. See api/utils/storage.py.
    MAX_STORAGE_BYTES_PER_USER: int = 0
    # Registration-abuse controls:
    BLOCK_DISPOSABLE_EMAILS: bool = False  # reject known throwaway email domains
    SIGNUPS_PER_DAY_GLOBAL: int = 0  # 0 = unlimited; global daily signup ceiling
    # Cloudflare Turnstile captcha on signup. Empty secret = disabled (self-host
    # default); the site key is public and served to the SPA via GET /api/config.
    TURNSTILE_SECRET_KEY: str = ""
    TURNSTILE_SITE_KEY: str = ""

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
                raw = "postgresql://" + raw[len(prefix) :]
                break
        parts = urlsplit(raw)
        return urlunsplit(("postgresql+asyncpg", parts.netloc, parts.path, "", ""))

    @property
    def db_connect_args(self) -> dict:
        """TLS for managed Postgres (Neon) without breaking local docker
        Postgres. Decided by the raw URL's ``sslmode``."""
        sslmode = (
            parse_qs(urlsplit(self.DATABASE_URL).query).get("sslmode", [""])[0].lower()
        )
        return {"ssl": True} if sslmode not in ("", "disable", "allow") else {}


settings = Settings()
