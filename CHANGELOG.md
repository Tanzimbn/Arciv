# Changelog

All notable changes to Arciv will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Per-user model selection.** The AI model is now a user setting
  (`users.ai_model`; `NULL` = the provider's default) instead of a constant in
  each provider module. `POST /api/settings/ai/models` lists what a key can
  actually reach, read from the provider's own catalogue and cached per
  (provider, key hash) for `AI_MODELS_CACHE_TTL` (default 3600s, `0` disables).
  Rate limited by `AI_MODELS_PER_MINUTE` (default 6). The Settings field falls
  back to free-text entry if the listing fails, so a rejected key can't lock a
  user out of the one setting that fixes their outage.
- **The key is checked before it is saved.** The listing accepts an optional
  `{provider, api_key}` for a key typed into Settings but not yet saved (POST, so
  the secret never rides in a URL; nothing is persisted). Listing models is the
  cheapest credential check available — no completion, nothing billed — so
  pasting a key immediately answers both "is this key good?" and "what can it
  run?". A refused key returns **400** carrying the provider's own words
  (e.g. Groq's `expired_api_key`) rather than a 502 blaming the provider, and the
  response's `key_source` distinguishes the user's key from the instance's shared
  one.
- **Provider errors are shown as sentences, not wire format.** Every SDK
  stringifies its errors as `Error code: 401 - {'error': {'message': 'Invalid API
  Key', 'type': …, 'code': 'expired_api_key'}}`; a UI that prints that is printing
  a debugging artifact. `agent.errors.human_message` extracts the provider's own
  message and appends the machine code — `Invalid API Key (expired_api_key)` —
  keeping the part that tells the user *which* fix applies (rotate the key vs. you
  pasted the wrong string). Applied at the three user-facing boundaries: the
  model-listing 400/502 `detail`, `POST /settings/ai/test`'s `message`, and the
  `ai_config` notification body. Unparseable text falls through verbatim rather
  than being replaced with a friendlier lie, and `links.ai_error` plus the worker
  logs still keep the raw string for debugging.
- Settings now renders a failed model listing as a card — what was rejected, the
  provider's sentence, what to do about it, and a **Check again** button — instead
  of a raw error string with an inline text link.
- **Checking a key is now an explicit act.** The API Key field has a **Check key**
  button (Enter in the field does the same, instead of submitting the form and
  saving an unverified key); nothing is sent to the provider while the key is being
  typed. The previous debounce fired mid-key, so every prefix of a valid key came
  back "rejected" and each pause cost a request. Switching provider drops a
  pending check, because a key verified against Groq says nothing about OpenAI.
- **Settings says whether a key is stored, and which one.** A saved key for the
  currently selected provider shows as `Groq key saved` with the masked value; when
  the selection differs from the saved provider it says so explicitly, because an
  account holds **one** key (`users.ai_api_key_enc`), not one per provider — so
  Clear removes that single key and a new key replaces it.

### Changed
- `mask_api_key` now reveals the **last** 4 characters as well as the first 4
  (`gsk_...4f2a`). A prefix-only mask identified the provider and nothing else —
  every key a provider issues shares its prefix, so someone who had just rotated a
  key could not tell the new one from the old one. At most 8 characters are ever
  shown, and only for keys of 16+ characters; shorter values keep `abcd...****`.
- **Breaking for self-hosters:** fetching URLs that resolve to a private or
  loopback address is now blocked by default. If you save links from hosts on your
  own LAN, set `ALLOW_PRIVATE_NETWORK_FETCH=true` in `.env`. Keep it `false` on
  anything reachable from the internet.
- New settings: `ALLOW_PRIVATE_NETWORK_FETCH` (default `false`),
  `MAX_FETCH_REDIRECTS` (default `5`), `FEEDS_DISCOVER_PER_MINUTE` (default `10`).

### Fixed
- **Links no longer sit on "Classifying…" forever after a provider retires a
  model.** Permanent AI failures (unknown/retired model, rejected key) are now
  terminal on the first attempt: they skip the 2 min → 10 min → 1 hour ladder and
  are excluded from the hourly `sweep_failed_links` requeue via a new
  `links.ai_error_kind='config'` marker. Previously a `404 model_decommissioned`
  was treated as transient, so the link cycled `pending → processing → failed →
  pending` — and since the ladder (~72 min) outran the sweep (60 min) it read as
  `pending`, which the UI renders as "Classifying…". `POST /links/:id/retry-ai`
  clears the marker.
- Broken AI configuration now raises **one** in-app notification per user per day
  (`type="ai_config"`), carrying the provider's own message, rather than failing
  silently. `ai_error` bytes are accounted against the storage quota on every
  failure branch, not just on success.
- Groq's default model updated to `llama-3.3-70b-versatile` —
  `llama-3.1-8b-instant` was decommissioned upstream.
- Unknown `ai_provider` values now raise instead of silently falling back to
  Gemini, which turned a typo into a confusing wrong-credentials error.

### Removed
- **The Telegram integration is gone.** It never shipped enabled
  (`TELEGRAM_ENABLED` defaulted to false), no account was ever linked, and it has
  been dropped from the roadmap rather than paused. Deleted: `bot/`,
  `api/routers/telegram.py`, `api/schemas/telegram.py`, `worker/daily_digest.py`,
  the `TELEGRAM_*` settings, the `bot` Compose service in both stacks, the Render
  env entry, the `python-telegram-bot` dependency, the Settings panel and its
  notification toggle. Migration `0016_drop_telegram` drops the four `users`
  columns (`telegram_chat_id`, `telegram_link_token`,
  `telegram_link_token_expires_at`, `feed_notify_telegram`) — every one was
  unread and unpopulated, so no user data is affected. Feed and digest
  notifications remain, in-app.

### Security
- The Ollama provider's `base_url` is the user's stored `ai_api_key`, so all three
  of its requests (`/api/chat` × 2, `/api/tags`) now go through
  `safe_fetch.safe_request` like every other user-supplied URL. On a hosted
  instance it was previously a blind SSRF/port probe, and the new model listing
  would have made it a read primitive. `safe_request` gained a `json` body
  parameter for this, with 301/302/303 dropping the body and switching to GET.
- **Outbound fetching of user-supplied URLs is now guarded in one place**
  (`api/utils/safe_fetch.py`). Every fetcher — link metadata, article text, URL
  canonicalisation, feed discovery, subscribe-time history seeding, and the feed
  poll cron — goes through it. Per redirect hop it rejects non-`http(s)` schemes,
  resolves the hostname and rejects the host if *any* returned address is private,
  loopback, link-local, reserved, multicast, unspecified, CGNAT (`100.64.0.0/10`),
  `192.0.0.0/24` or `198.18.0.0/15`, then connects **pinned to the validated
  address** while preserving the `Host` header and TLS certificate hostname.
  Pinning closes DNS rebinding; per-hop revalidation closes redirect-based bypass.
- `POST /api/feeds/discover` now **requires authentication** (it was open, and
  makes up to seven outbound requests per call) and is rate limited via
  `FEEDS_DISCOVER_PER_MINUTE` (default 10).
- `POST /api/links` applies its rate limit and quota checks *before* the first
  outbound fetch, and answers `400` instead of `500` for a rejected URL.

## [0.1.0] - 2026-05-02

### Added
- **Core Link Management**
  - URL input with automatic metadata extraction
  - AI-powered classification into queues (Watch Later, Read Later, Try Later, Inbox)
  - AI-generated summaries and tags
  - Manual queue overrides and tagging
  - Link deduplication with canonical URL normalization
  - Mark as done functionality with archive view

- **AI Integration**
  - Support for multiple AI providers (Gemini, Groq, Claude, OpenAI, Ollama)
  - Graceful degradation when AI is unavailable
  - URL heuristic fallback classification
  - Retry logic with exponential backoff
  - Per-user API key encryption
  - Shared Gemini key for free tier users

- **Feed Tracking**
  - RSS/Atom feed discovery from URLs
  - Daily feed polling with configurable schedule
  - Import of 10 most recent items on subscription
  - Feed failure handling with degraded/dead status
  - Manual feed refresh
  - Pause/resume feed updates

- **Notifications**
  - In-app notification bell with unread count
  - Notification panel with mark all read functionality
  - Configurable notification preferences

- **User Interface**
  - Clean, minimalist design with Tailwind CSS
  - Responsive layout for mobile and desktop
  - Queue-based filtering (All, Watch Later, Read Later, Try Later, Inbox, Archive)
  - Real-time status indicators for AI processing
  - Error states for unreachable links and failed AI processing
  - Feed status indicators (active, paused, degraded, dead)

- **Technical Features**
  - FastAPI backend with async support
  - PostgreSQL database with proper indexing
  - Redis-backed job queue with ARQ
  - JWT authentication with secure token handling
  - AES-256 encryption for API keys
  - Docker Compose deployment
  - Database migrations with Alembic
  - Health check endpoint

- **Security**
  - Rate limiting on link submission (30/hour per user)
  - User-scoped database queries
  - Encrypted API key storage
  - Input validation and URL canonicalization

### Technical Details
- **Backend**: Python 3.11+, FastAPI, SQLAlchemy, Alembic
- **Database**: PostgreSQL 16+ with proper indexes
- **Queue**: Redis 7+ with ARQ job processing
- **Frontend**: React 18+, Vite, Tailwind CSS
- **AI SDK**: Unified interface supporting multiple providers
- **Deployment**: Docker Compose with health checks

### Performance
- Link save API responds within 500ms (AI processing async)
- Feed polling completes within 1 hour for up to 500 feeds
- Mobile-responsive design with touch-friendly interface
- Efficient database queries with proper indexing

### Known Limitations
- Single user per instance (multi-user planned for v0.2.0)
- No full-text search (planned for v0.2.0)
- No browser extension (planned for v0.2.0)
- No data export functionality (planned for v0.2.0)

### Documentation
- Comprehensive README with quickstart guide
- Detailed environment variable documentation
- Architecture overview and deployment guide
- API documentation available via FastAPI auto-docs

---

## [Unreleased]

### Added
- **Auth hardening** — email verification (block-until-verified), short-lived access JWT + DB-backed refresh tokens with rotation & revocation, password reset, password-strength rules, and per-endpoint rate limiting (slowapi + Redis).
- **Email delivery** — Gmail API (HTTPS) backend that works where outbound SMTP ports are blocked, plus a classic SMTP backend. Off by default (`EMAIL_ENABLED`); links log to stdout in local dev.
- **Admin monitoring panel** — `/admin` dashboard (gated by `ADMIN_EMAILS`) with daily traffic, unique visitors, and signups over 30 days, plus user management. Traffic/unique-visitor metrics use lightweight Redis aggregate counters (INCR + HyperLogLog on hashed IPs, no per-request rows); `GET /api/admin/stats`.
- **Deploy** — Render blueprint; Neon/Upstash compatibility; secret scanning in CI.

### Changed
- Interactive API docs (`/docs`, `/redoc`, `/openapi.json`) are disabled when `ENVIRONMENT=production`.
- Access-token lifetime default lowered from 7 days to 15 minutes (refresh tokens now keep sessions alive).

### Planned (next — AI productivity layer)
- Per-link embeddings at save time (pgvector) — foundation for the below
- Semantic search over the saved library
- Similar-links panel + near-duplicate detection
- AI-ranked resurface / weekly digest
- Browser extension, data export (JSON, OPML), OAuth login

---

## Support

- **Issues**: [GitHub Issues](https://github.com/Tanzimbn/Arciv/issues)
- **Documentation**: [README.md](README.md)
- **Community**: [GitHub Discussions](https://github.com/Tanzimbn/Arciv/discussions)

---

**Built with ❤️ for people who love to read and learn**
