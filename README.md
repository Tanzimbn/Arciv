<div align="center">

# Arciv

**A self-hostable, AI-powered link and feed manager.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python 3.12](https://img.shields.io/badge/Python-3.12-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.111-009688.svg)](https://fastapi.tiangolo.com/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED.svg)](https://www.docker.com/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

</div>

> **Status:** Early alpha. The MVP is functional and self-hostable, but APIs and schemas may still change. Feedback and PRs welcome.
>
> **Where it's heading:** alongside self-hosting, Arciv is being prepared to run as a **public, hosted service** — sign up on the deployed site and use it by bringing your own AI provider key. Self-hosting stays a first-class supported mode. The hosted offering is *planned, not live yet*; see [Roadmap → Public hosted service](#public-hosted-service).

Arciv is a personal read-it-later that thinks. Save any URL — the system pulls metadata, runs it through an AI provider you control, and routes it into the right queue (Watch Later, Read Later, Try Later, Inbox). Subscribe to RSS feeds and get notified when new posts appear — no spam, no auto-ingest.

All five MVP phases are scaffolded: foundation, link saving, AI pipeline, feed tracker, notifications + optional Telegram.

---

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [AI Providers](#ai-providers)
- [Feed Tracking](#feed-tracking)
- [Telegram Bot (Optional)](#telegram-bot-optional)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Development](#development)
- [Monitoring](#monitoring)
- [Security](#security)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [Roadmap](#roadmap)
- [License](#license)

---

## Features

- **Smart link saving** — paste a URL, get metadata extraction, canonicalization, and dedup at the DB level.
- **AI-powered classification** — links are categorized as `article`, `video`, `tool`, `research-paper`, etc. and routed to the right queue. Each one gets a 2–3 sentence summary and a handful of tags.
- **Bring your own provider** — works out of the box with **Gemini**, **Groq**, **Anthropic Claude**, **OpenAI**, or **Ollama Cloud**. Keys are encrypted at rest with AES-256.
- **Graceful AI fallback** — if no provider is configured (or the provider rate-limits you), links fall back to URL-pattern heuristics. The system never blocks on AI.
- **Feed tracking, the polite way** — subscribe to RSS/Atom feeds and receive a single grouped notification per feed when new posts appear. **No auto-ingest** — you decide what to save. RSS auto-discovery, ETag/Last-Modified conditional polling, failure handling (degraded at 7 consecutive failures, dead at 30).
- **In-app notifications** — bell icon with unread counter, accessible across the app.
- **Optional Telegram bot** — link your account with a one-time token, save URLs via DM, receive daily digests. Off by default behind a feature flag.
- **Production-grade auth** — email verification (block-until-verified), short-lived access JWT + rotating refresh tokens, password reset, password-strength rules, and per-endpoint rate limiting. Verification/reset email via Gmail API or SMTP.
- **Admin monitoring panel** — an `/admin` dashboard (gated by `ADMIN_EMAILS`) showing daily traffic, unique visitors, and signups, plus user management. Metrics use lightweight Redis aggregate counters (no per-request rows, IPs hashed).
- **Single-command self-hosting** — `docker compose up`. Postgres, Redis, API, worker, all in one stack. Frontend served by FastAPI in production.
- **Cron-driven feed polling** — configurable schedule (default daily at 08:00 UTC).

## Quick Start

### Prerequisites

- Docker and Docker Compose v2 (`docker compose`, not `docker-compose`)
- A few minutes

### 1. Clone and configure

```bash
git clone https://github.com/Tanzimbn/Arciv.git
cd Arciv
cp .env.example .env
```

### 2. Generate secrets

```bash
# Two 32-byte hex strings — paste into SECRET_KEY and ENCRYPTION_KEY in .env
openssl rand -hex 32
openssl rand -hex 32
```

### 3. (Optional) Add a free AI provider key

Either:
- A personal Gemini key from [Google AI Studio](https://aistudio.google.com/apikey) — set in Settings after first login.
- A shared Gemini key at the server level via `SHARED_GEMINI_KEY` in `.env` (capped at 20 calls/user/day).

If neither is set, AI is skipped and links route by URL heuristics. The system stays fully functional.

### 4. Launch

```bash
docker compose up -d
```

Arciv is now serving at **http://localhost:8000**. Migrations run automatically on API startup.

### 5. First steps

1. Register at http://localhost:8000.
2. Save a link from the input bar at the top.
3. Visit **Settings** to configure your AI provider (optional).
4. Visit **Feeds** to subscribe to a blog.

## Configuration

All configuration is via `.env`. See [.env.example](.env.example) for every variable with inline documentation.

### Required

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection URL (provided by Compose default) |
| `REDIS_URL` | Redis URL for the ARQ job queue (provided by Compose default) |
| `SECRET_KEY` | JWT signing key — generate with `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | AES-256 key for stored AI provider keys — generate with `openssl rand -hex 32` |

### Optional

| Variable | Default | Purpose |
|---|---|---|
| `SHARED_GEMINI_KEY` | *unset* | Shared free-tier Gemini key for users without their own. Capped at 20 calls/user/day. |
| `FEED_POLL_CRON` | `0 8 * * *` | When to poll all feeds. Only minute and hour are honored. |
| `USER_AGENT` | `Arciv/0.1 (+https://github.com/Tanzimbn/Arciv)` | Outbound HTTP User-Agent for feed/metadata fetches. Set this on a public instance so site operators can reach you. |
| `TELEGRAM_ENABLED` | `false` | Master switch for all Telegram features. See [Telegram Bot](#telegram-bot-optional). |
| `TELEGRAM_BOT_TOKEN` | *unset* | Required only when `TELEGRAM_ENABLED=true`. |
| `ADMIN_EMAILS` | *unset* | Comma-separated emails granted the admin panel (`/admin`) and `/api/admin/*`. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `15` | Access-JWT lifetime in minutes. Refresh tokens keep sessions alive. |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `30` | Refresh-token lifetime. Rotated on every use, revoked on logout/reset. |
| `EMAIL_ENABLED` | `false` | Turn on outbound email (verification, password reset). When off, links are logged to stdout for local dev. |
| `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` | *unset* | Gmail API (HTTPS) email backend — works where outbound SMTP ports are blocked. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | *unset* | Classic SMTP email backend (alternative to Gmail API). |
| `APP_BASE_URL` | `http://localhost:8000` | Base URL used to build verification / reset links in emails. |
| `ENVIRONMENT` | `development` | Set to `production` for production deploys (also disables API docs). |

## AI Providers

Configure your provider in **Settings**. The system uses one provider at a time per user; API keys are encrypted with AES-256 before they hit the database.

**Model** is also chosen in Settings, per user. The dropdown is populated live from your provider's own catalogue using your key, so a model your account can't reach never appears. Leave it on *Provider default* to use the model below. Providers retire models on their own schedule — picking a new one in Settings is the fix, no redeploy.

| Provider | Default model | Cost | Notes |
|---|---|---|---|
| **Google Gemini** | `gemini-2.0-flash` | Free tier available | Default. Free-tier quota varies by region. |
| **Groq** | `llama-3.3-70b-versatile` | Free tier available | Fast inference, generous free quota. |
| **Anthropic Claude** | `claude-haiku-4-5` | Paid | Best quality for the cost. |
| **OpenAI** | `gpt-4o-mini` | Paid | Industry standard. |
| **Ollama Cloud** | `gpt-oss:120b` | Free tier available | Open-weight models, hosted. Key from [ollama.com/settings/keys](https://ollama.com/settings/keys). |

The defaults are current at the time of writing, not a guarantee — they are the value used when you pick no model.

**Retry behavior:** AI jobs retry on *transient* errors (provider 5xx, rate limits) at 2 min → 10 min → 1 hour, then mark `ai-failed`; failed jobs are swept back into the queue hourly.

*Permanent* errors are not retried. A retired or unknown model, or a rejected API key, fails the link immediately and raises one in-app notification carrying the provider's own message — retrying an identical request that cannot succeed only hides the problem. Fix the model or key in Settings, then hit **Retry** on the link. If your account has zero quota (`limit: 0`), all retries will fail — switch providers or top up.

## Feed Tracking

Feeds are **notification-only**, not auto-ingest. This is a deliberate product decision.

**What this means:**
- Subscribing to a feed records the URL plus its current item GUIDs. No `Link` rows are created at subscription time.
- When the daily poll finds new posts, you get **one grouped notification per feed** listing each post's title and URL.
- You decide what to save. Paste interesting URLs into the link input bar — the standard AI pipeline runs on them.

**Why:** feeds in Arciv act as an *alert source*, not a pipeline that pumps posts into your read queue. You explicitly endorse what you want to read.

**Polling:**
- Daily cron at 08:00 UTC (override with `FEED_POLL_CRON`).
- Uses `ETag` and `If-Modified-Since` to avoid re-downloading unchanged feeds.
- 7 consecutive failures → feed marked `degraded` (still polled).
- 30 consecutive failures → feed marked `dead` (skipped, user notified).

## Telegram Bot (Optional)

Disabled by default. To enable:

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy its token.
2. In `.env`:
   ```env
   TELEGRAM_ENABLED=true
   TELEGRAM_BOT_TOKEN=<your-token>
   ```
3. Start the bot service (it's behind a Compose profile):
   ```bash
   docker compose --profile telegram up -d
   ```
4. In the Arciv UI, go to **Settings → Telegram** and generate a linking token.
5. Send `/start <token>` to your bot.

**What the bot does:**
- Forward any URL to it → it's saved as a link in your account (full AI pipeline runs).
- Daily digest at 09:00 UTC — same content as the in-app notification.

**When disabled** (`TELEGRAM_ENABLED=false`, the default), the `/api/telegram/*` routes aren't registered, the digest cron is skipped, and the `bot` service doesn't start.

## Architecture

| Layer | Technology | Why |
|---|---|---|
| Backend API | Python + FastAPI (async) | Async I/O suits the AI + RSS workload |
| Job queue | ARQ + Redis | Persistent jobs survive worker restarts |
| Database | PostgreSQL 16 | Reliability + `TIMESTAMPTZ` + future pgvector |
| Frontend | React + Vite + TailwindCSS | Built into a static bundle, served by FastAPI |
| Auth | JWT (`python-jose`) + bcrypt | Stateless, no session store |
| Encryption | `cryptography` (AES-GCM) | API keys at rest |
| Feed parsing | `feedparser` | Handles RSS 1.0, 2.0, Atom |
| Scraping | `httpx` + `BeautifulSoup4` | Async metadata fetch |
| Telegram bot | `python-telegram-bot` (long-poll) | No webhook required |
| Migrations | Alembic | Async-aware migration env |
| Deployment | Docker + Docker Compose | One-command self-hosting |

**Design principles** (from [CLAUDE.md](CLAUDE.md)):
- **AI is async and never blocking.** `POST /api/links` returns within 500ms; AI runs in the worker.
- **AI is optional.** Without a provider, links route via URL heuristics.
- **All data scoped by `user_id`.** Every query filters on the authenticated user.
- **API keys encrypted at rest.** Decrypted only in worker memory, never returned to the client.

## Project Structure

```
arciv/
├── api/                # FastAPI app — routers, models, schemas, middleware, utils
├── agent/              # AI provider abstraction + 5 provider implementations
├── worker/             # ARQ jobs — ai_classify, feed_poll, daily_digest
├── bot/                # Telegram bot (long-polling)
├── db/migrations/      # Alembic versions
├── frontend/           # React SPA (Vite + Tailwind)
├── docs/               # MVP + full spec, link state diagram
├── docker-compose.yml
├── docker-compose.prod.yml
├── Dockerfile
└── .env.example
```

## Development

### Backend (without Docker for the app, with Docker for db/redis)

Use **Python 3.12** — the same version the Dockerfile and CI pin. Several
dependencies (`asyncpg`, `pydantic-core`) have no prebuilt wheels for 3.13, so a
3.13 interpreter falls back to compiling them from source and fails without a
full C/Rust toolchain.

```bash
# Backing services
docker compose up -d db redis

# Python deps
python3.12 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# Migrations
alembic upgrade head

# API
uvicorn api.main:app --reload

# Worker (separate terminal)
arq worker.worker.WorkerSettings

# Telegram bot (only if TELEGRAM_ENABLED=true)
python bot/main.py
```

### Frontend

```bash
cd frontend
npm ci
npm run dev          # dev server at http://localhost:5173 (proxies /api to :8000)
npm run build        # builds frontend/dist for production
```

### Tests

```bash
pip install -r requirements.txt -r requirements-dev.txt
ruff check .
pytest                       # unit layer only; integration tests skip with a reason
```

The integration layer runs the real app against a real Postgres (pgvector) and
Redis. Throwaway containers on non-default ports so they can't collide with your
dev stack:

```bash
docker run -d --name arciv-test-pg -e POSTGRES_USER=arciv -e POSTGRES_PASSWORD=arciv \
  -e POSTGRES_DB=arciv_test -p 55432:5432 pgvector/pgvector:pg16
docker run -d --name arciv-test-redis -p 56379:6379 redis:7

TEST_DATABASE_URL=postgresql://arciv:arciv@localhost:55432/arciv_test \
TEST_REDIS_URL=redis://localhost:56379/15 \
pytest
```

Full details — fixtures, environment variables, why the event loop is
session-scoped — in [tests/README.md](tests/README.md).

### Database migrations

```bash
# Create a new migration after editing a model
alembic revision --autogenerate -m "describe the change"

# Apply
alembic upgrade head

# Rollback one revision
alembic downgrade -1
```

### Adding a new AI provider

1. Implement the `AIProvider` interface in [agent/providers/](agent/providers/) (subclass `agent.base.AIProvider`).
2. Register it in [agent/registry.py](agent/registry.py)'s `make_provider` factory.
3. Add the provider name to the `_ALLOWED_PROVIDERS` set in [api/routers/settings.py](api/routers/settings.py) so users can select it.
4. Update this table in the README.

## Monitoring

### Admin dashboard

Users listed in `ADMIN_EMAILS` get an **Admin** panel at `/admin`:

- **Overview** — daily requests, unique visitors, and signups over the last 30 days, with today's totals. Traffic and unique visitors come from Redis aggregate counters (`stats:req:*`, `stats:uv:*` HyperLogLog, `stats:err:*`) written by a best-effort HTTP middleware — tiny footprint, no per-request rows, visitor IPs hashed. Signups are derived from `users.created_at`.
- **Users** — list and delete users (admins can't be deleted).

Backed by `GET /api/admin/stats?days=30`.

### Health check

```bash
curl http://localhost:8000/health
```

Returns API status plus database, Redis, and last feed poll timestamp.

### Logs

```bash
docker compose logs -f          # all services
docker compose logs -f api      # API only
docker compose logs -f worker   # worker only
```

## Security

- **Encryption at rest:** AI provider API keys are AES-GCM encrypted with `ENCRYPTION_KEY` before storage. Rotating `ENCRYPTION_KEY` invalidates all stored keys (users re-enter them).
- **Authentication:** short-lived access JWT (HS256, 15 min default) plus a DB-backed refresh token with rotation and revocation. Email verification is required before login; password reset over single-use Redis tokens; password-strength rules on register/reset. Auth endpoints are rate-limited (login, register, forgot/resend, reset).
- **Multi-tenancy:** every database query filters on `user_id`. Cross-user access is structurally impossible. Admin endpoints (`/api/admin/*`) are gated by `ADMIN_EMAILS`.
- **Production hardening:** interactive API docs (`/docs`, `/redoc`, `/openapi.json`) are disabled when `ENVIRONMENT=production`.
- **SSRF protection:** outbound HTTP requests refuse private network ranges and non-`http(s)` schemes.
- **URL canonicalization:** trailing slashes normalized, tracking params (`utm_*`, `fbclid`, `gclid`, `ref`) stripped, redirects followed before storage.
- **CI hardening:** PR builds in GitHub Actions never write to shared caches (no cache-poisoning vector).

## Deployment

### Production with Docker Compose

```bash
cp .env.example .env
# Edit .env: set ENVIRONMENT=production, generate fresh secrets, enable Telegram if wanted
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### Pre-built images

GHCR images are published on every push to `main` and on version tags (`v*`), multi-platform (amd64 + arm64):

```
ghcr.io/tanzimbn/arciv:latest
ghcr.io/tanzimbn/arciv:v0.1.0
ghcr.io/tanzimbn/arciv:sha-<short>
```

Use any of these in your own Compose file.

### Reverse proxy

For HTTPS, terminate TLS in a reverse proxy (nginx, Caddy, Traefik). An example nginx config is included as [nginx.conf](nginx.conf).

### Sizing

- **Memory:** 1 GB minimum (Postgres + Redis + Python services). 2 GB recommended.
- **Storage:** 1 GB for the OS layers + database growth (links + summaries are small, ~1 KB each).
- **Network:** outbound HTTPS to AI providers and feed sources.

## Contributing

PRs welcome. The project is small enough that a single PR can land a meaningful feature.

1. Fork the repo and create a feature branch from `main` (e.g. `feat/full-text-search`).
2. Make your change. Keep commits focused — one concern per commit, conventional-commits style (`fix(api): …`, `feat(agent): …`).
3. Run `ruff check .` and `pytest` (see [Tests](#tests)). Add a test for anything touching tenancy scoping, quotas, or key handling — those are the invariants that make a public instance safe to leave open.
4. Open a PR against `main` with a description of *why* the change exists. CI runs lint, the test suite against real Postgres/Redis, the SPA build, and a secret scan.

If you're working on something that touches the spec (`docs/requirements-mvp.md`), call out the deviation in the PR description.

### Project guidelines

- **Python is async everywhere.** Routers, DB sessions, `httpx`, and ARQ jobs. Avoid sync calls in request paths.
- **Every datetime is timezone-aware UTC.** Use `datetime.now(timezone.utc)`, never `datetime.utcnow()`.
- **Every DB query filters on `user_id`.** No exceptions.
- **New ARQ jobs must be registered** in [worker/worker.py](worker/worker.py) `WorkerSettings.functions`.
- **Touching a model? Add a new migration.** Don't edit existing ones.

### Shipped since 0.1.0
- Production auth hardening — email verification, refresh-token rotation, password reset, rate limiting
- Gmail API email backend (works where SMTP ports are blocked)
- Admin monitoring panel — traffic, unique visitors, signups + user management

## Roadmap

### Public hosted service
The direction: run Arciv as a hosted, multi-tenant site so anyone can use it without self-hosting — **bring your own AI provider key** (from the providers the app offers) and go. Self-hosting stays first-class. This is a *deployment/operations layer on top of the existing app*, not a rewrite — the tenancy foundation (`user_id` scoping, AES-256 key encryption, email verification, auth rate limiting, SSRF guard) already exists. What's left before it can safely be public:
- **Rate limiting on non-auth routes** — `POST /links` and `/links/search` are currently unlimited (auth routes already are). Search especially, since each query runs a server-side embedding.
- **Per-user resource quotas** — max links / feeds / storage per account, so one user can't fill the DB.
- **Registration-abuse controls** — throttle / captcha on open signup beyond the current per-IP cap; disposable-email handling.
- **Key-custody hardening** — a single `ENCRYPTION_KEY` today encrypts every user's provider key; add envelope encryption + a rotation path before holding many users' keys.
- **Embedding-load control** — cap concurrent embeds (or split embedding to its own service) so search traffic can't starve request handling.
- **Legal & lifecycle** — Terms of Service, privacy policy, and self-serve data export + account deletion.

Not committed to a date; tracked as the "Public hosted launch" block in [docs/requirements-full.md](docs/requirements-full.md).

### AI productivity layer (next focus)
The core bet: turn a growing pile of saved links into something queryable and self-surfacing.
- **Embeddings at save time (pgvector)** — the foundation for everything below
- **Semantic search** — "that article about Go concurrency" without the title
- **Similar links** — related saves in the detail drawer; near-duplicate detection at save time
- **Resurface digest** — AI-ranked weekly nudge of forgotten-but-relevant links (`worker/daily_digest.py` is scaffolded)

### v0.2
- Browser extension for one-click save
- Data export (JSON, OPML for feeds)
- Better error visibility in the UI (AI failures, feed degradation)

### v0.3 (later)
- OAuth providers for login
- Mobile-friendly responsive polish
- "Ask your library" — RAG chat over saved links, grounded with citations

### Open ideas
- Webhook destinations for new feed items (Discord, Slack)
- iOS/Android share-sheet integration
- Per-feed AI prompt overrides

Got an idea? Open a [Discussion](https://github.com/Tanzimbn/Arciv/discussions).

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgements

- [FastAPI](https://fastapi.tiangolo.com/), [ARQ](https://arq-docs.helpmanual.io/), [SQLAlchemy](https://www.sqlalchemy.org/), [feedparser](https://feedparser.readthedocs.io/) — the backbone of the backend.
- [Vite](https://vitejs.dev/) + [TailwindCSS](https://tailwindcss.com/) — for the frontend.
- The teams behind Gemini, Groq, Claude, OpenAI, and Ollama for making BYOK practical.

---

<div align="center">
Made for people who want to read more deliberately.
</div>
