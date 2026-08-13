# Changelog

All notable changes to Arciv will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security
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

### Changed
- **Breaking for self-hosters:** fetching URLs that resolve to a private or
  loopback address is now blocked by default. If you save links from hosts on your
  own LAN, set `ALLOW_PRIVATE_NETWORK_FETCH=true` in `.env`. Keep it `false` on
  anything reachable from the internet.
- New settings: `ALLOW_PRIVATE_NETWORK_FETCH` (default `false`),
  `MAX_FETCH_REDIRECTS` (default `5`), `FEEDS_DISCOVER_PER_MINUTE` (default `10`).

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
  - Telegram bot integration for daily digests
  - Save links by forwarding to Telegram bot
  - Configurable notification preferences

- **Telegram Bot**
  - Secure token-based account linking
  - URL submission via message forwarding
  - Daily digest messages with new feed items
  - Bot commands (/start, /help)
  - Error handling and user feedback

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
  - Telegram webhook validation

### Technical Details
- **Backend**: Python 3.11+, FastAPI, SQLAlchemy, Alembic
- **Database**: PostgreSQL 16+ with proper indexes
- **Queue**: Redis 7+ with ARQ job processing
- **Frontend**: React 18+, Vite, Tailwind CSS
- **AI SDK**: Unified interface supporting multiple providers
- **Bot**: python-telegram-bot with webhook support
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
