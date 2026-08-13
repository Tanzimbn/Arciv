# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Arciv** is a self-hostable intelligent link and feed manager. Users save URLs manually or via RSS feeds; an AI pipeline classifies, summarises, and routes them into smart queues. All five MVP phases are scaffolded end-to-end (foundation, link saving, AI pipeline, feed tracker, notifications + Telegram bot). Code lives at project root; docs in `docs/`.

Continue hardening the MVP (`docs/requirements-mvp.md`), then extend toward the full spec (`docs/requirements-full.md`).

**Deployment direction (hardening layer mostly shipped).** Arciv is moving from self-host-only to also running as a **public, hosted multi-tenant service**: anyone can sign up on the deployed site and use it by bringing their own AI provider API key (from the providers the app offers). Self-hosting stays a first-class, supported mode. This pivot adds a *public-internet hardening layer* on top of the existing tenancy foundation (`user_id` scoping, AES-256 key encryption, email verification, auth rate limiting, SSRF guard on outbound fetches). **Shipped** on `feat/public-launch-hardening`: per-minute rate limits on non-auth routes (link create, `/links/search`, insights), link + feed count quotas, per-account storage-bytes cap (`MAX_STORAGE_BYTES_PER_USER` + running `users.storage_bytes`, `api/utils/storage.py`), disposable-email block + per-IP signup guards + Cloudflare Turnstile signup captcha (`TURNSTILE_SECRET_KEY`/`TURNSTILE_SITE_KEY`, off by default; public site key served via `GET /api/config`), envelope encryption + `ENCRYPTION_KEY` rotation, bounded server-side embedding (+ optional `embed-service/`), legal (ToS + privacy) + `GET /api/account/export` + `DELETE /api/account`, and guided BYOK onboarding (first-login prompt + dismissible banner when a user has no personal key and the instance has no shared key — `SettingsResponse.shared_ai_available`, `components/ByokOnboarding.jsx`). **All pre-launch public-hardening items are shipped.** See `docs/requirements-full.md` §3.6 and the "Public hosted launch" roadmap block for per-item state. Verify against code before claiming any specific item.

## Tech Stack

| Layer | Technology |
|---|---|
| Backend API | Python + FastAPI (async) |
| Job queue | ARQ (Redis-backed, for MVP); BullMQ in full spec |
| Database | PostgreSQL + pgvector (for embeddings in later phases) |
| Cache/Queue backend | Redis |
| Feed parsing | `feedparser` |
| HTTP/scraping | `httpx` + `beautifulsoup4` |
| Frontend | React + Vite + TailwindCSS (SPA) |
| Auth | JWT (`python-jose`) + bcrypt |
| Telegram bot | `python-telegram-bot` |
| DB migrations | Alembic |
| Containerisation | Docker + Docker Compose |

## Project Structure

```
arciv/  (project root — /Users/tanzimbn/Documents/projects/Arciv/)
├── api/                        # FastAPI application
│   ├── routers/                # auth, links, feeds, notifications, settings, telegram
│   ├── models/                 # user, link, feed, notification, job
│   ├── schemas/                # auth, link, feed, notification, settings, telegram
│   ├── middleware/             # auth.py — JWT get_current_user
│   ├── utils/                  # security (bcrypt), encryption (AES-256), heuristics,
│   │                           # metadata fetch, feed_discovery
│   ├── config.py               # Pydantic settings from .env
│   ├── database.py             # Async SQLAlchemy engine + get_db
│   └── main.py                 # FastAPI app, /health, static SPA serving
├── agent/                      # AI pipeline
│   ├── base.py                 # AIProvider ABC + AIResult dataclass
│   ├── prompt.py               # Shared prompt + AuthError/QuotaError/ParseError
│   ├── registry.py             # make_provider(name, api_key) factory
│   └── providers/              # gemini, groq_provider, anthropic_provider,
│                               # openai_provider, ollama
├── worker/                     # ARQ jobs
│   ├── worker.py               # WorkerSettings — registers functions + cron jobs
│   ├── ai_classify.py          # classify_link + sweep_failed_links
│   ├── feed_poll.py            # poll_all_feeds + poll_single_feed
│   └── daily_digest.py         # send_daily_digest cron
├── bot/
│   └── main.py                 # Telegram bot — long-polling, /start linking, URL submit
├── db/
│   └── migrations/
│       ├── env.py              # Async Alembic env
│       └── versions/           # 0001 users+links, 0002 jobs,
│                               # 0003 feeds+notifications, 0004 telegram fields,
│                               # 0005 timestamptz, 0006 feed_category
├── frontend/                   # React + Vite + Tailwind SPA
│   └── src/
│       ├── views/              # LoginView, LinksView, FeedsView, SettingsView
│       ├── components/         # QueueTabs, UrlInputBar, LinkCard, NotificationBell,
│       │                       # SubpageNav
│       └── api/client.js
├── alembic.ini
├── docker-compose.yml          # db, redis, api, worker, bot
├── Dockerfile
├── requirements.txt
├── .env.example
└── .env                        # local dev — gitignored
```

## Architecture Principles

**AI is async and never blocking.** The `POST /api/links` endpoint must return within 500ms. AI classification always runs in a background job queue — never in the request thread.

**AI is optional.** The system must work fully without a configured AI provider. Links fall back to URL-pattern heuristics or stay in `Inbox` queue until AI is available:
- `youtube.com`, `youtu.be`, `vimeo.com` → `video` → Watch Later  
- `github.com`, `gitlab.com`, `npmjs.com`, `pypi.org` → `tool` → Try Later  
- `arxiv.org` → `research-paper` → Read Later  
- `substack.com` → `newsletter` → Read Later  
- Default → `article` → Read Later

**AI provider interface** — all providers implement one interface, swappable via settings:
```python
class AIProvider:
    async def classify_and_summarise(self, title: str, content: str, url: str) -> AIResult | None:
        ...
```

**Persistent job queue.** ARQ jobs are Redis-backed. Server restarts must not lose pending jobs. AI retry schedule: immediate → 2 min → 10 min → 1 hour → mark `ai-failed`.

**All data scoped by `user_id`.** Every DB query must include a `user_id` filter. No cross-user access is possible.

**API keys encrypted at rest.** `ai_api_key_enc` in the DB uses AES-256 (`api/utils/encryption.py`). Keys are never returned in API responses — only a masked version (`sk-...****`).

**Shared Gemini key has a per-user daily cap.** When a user has not configured their own provider, `worker/ai_classify._get_provider` falls back to `SHARED_GEMINI_KEY` only up to `SHARED_DAILY_LIMIT` (currently 20) calls per user per day, tracked in Redis at `ai_usage:<user_id>:<YYYY-MM-DD>`. Past the cap, the link's `ai_status` stays `pending`.

## MVP Phases (all scaffolded — keep extending these)

Each phase is wired up; ongoing work is hardening, edge cases, and polish.

1. **Foundation** — Docker Compose (PostgreSQL 16 + Redis 7 + api + worker + bot), Alembic migrations, JWT auth, `GET /health` endpoint (probes DB + Redis ping + `arciv:last_feed_poll` Redis key set by worker).
2. **Link saving** — `POST /api/links` (metadata fetch via `api/utils/metadata.py`, URL canonicalisation, dedup at DB level), list/patch/delete, retry-ai. Frontend `LinksView` with `QueueTabs` + `UrlInputBar` + `LinkCard`.
3. **AI pipeline** — ARQ queue (`worker/worker.py`), five providers behind one interface, classify+summarise in a single LLM call, exponential backoff (2 min → 10 min → 1 hour → `failed`), hourly `sweep_failed_links` cron. Settings page (`/api/settings`, `/api/settings/ai/test`).
4. **Feed tracker** — `feeds` + `feed_items` tables, RSS auto-discovery (`api/utils/feed_discovery.py`), daily cron poll driven by `FEED_POLL_CRON`, failure handling with consecutive-failure tracking. Feeds support an optional `category` field (String, nullable) for user-defined grouping — exposed in `FeedCreate`, `FeedUpdate`, `FeedResponse` schemas and `PATCH /api/feeds/:id`. **Feeds are notification-only, not auto-ingest** (deliberate deviation from `requirements-mvp.md:220`): subscribing seeds existing GUIDs into `feed_items` with `link_id=NULL` but creates no `Link` rows; the daily poll likewise records new GUIDs and emits a single grouped notification (title + URL per new post in `Notification.body`) without saving anything. The user manually saves any post they want via the existing `POST /api/links` flow. Do not reintroduce auto-Link creation from feeds.
5. **Notifications + Telegram** — in-app notification bell, Telegram bot (`bot/main.py`) — token-based account linking, URL submission via DM, `send_daily_digest` cron at 09:00 UTC. **Telegram is currently disabled** by default: `TELEGRAM_ENABLED=false` skips the `/api/telegram/*` router registration in `api/main.py` and the digest cron in `worker/worker.py`, and the `bot` service is behind the `telegram` Compose profile (`docker compose --profile telegram up` to start it).

## Key API Endpoints (MVP)

```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/telegram/link

POST   /api/links              # Save URL — returns fast, AI is async
GET    /api/links              # ?queue=&status=&page=&limit=
PATCH  /api/links/:id          # Update queue, content_type, tags, status
DELETE /api/links/:id
POST   /api/links/:id/retry-ai

POST   /api/feeds/discover     # Returns feed info without subscribing
POST   /api/feeds
GET    /api/feeds
PATCH  /api/feeds/:id          # pause/resume, set category
DELETE /api/feeds/:id
POST   /api/feeds/:id/check-now

GET    /api/notifications
POST   /api/notifications/read-all

GET    /api/settings
PATCH  /api/settings
POST   /api/settings/ai/test

GET    /health                  # db + redis probe, last feed-poll timestamp
```

## Database Key Constraints

- `links` has `UNIQUE (user_id, canonical_url)` — deduplication is at the DB level
- `feed_items` has `UNIQUE (feed_id, guid)` — prevents duplicate RSS imports
- URL canonicalisation: follow all redirects, strip `utm_*`, `fbclid`, `gclid`, `ref` params, normalise trailing slash

## Environment Configuration

All config via `.env`; `.env.example` documents every variable. Current variables (see `api/config.py`):
- `DATABASE_URL`, `REDIS_URL`
- `SECRET_KEY` (JWT), `ALGORITHM`, `ACCESS_TOKEN_EXPIRE_MINUTES`
- `ENCRYPTION_KEY` (AES-256 for API keys at rest)
- `TELEGRAM_BOT_TOKEN`, `SHARED_GEMINI_KEY`
- `FEED_POLL_CRON` (default `0 8 * * *` — parsed in `worker/worker.py`; only minute and hour fields are honored)
- `ENVIRONMENT`

## Self-Hosting Requirement

`docker compose up` must start the full stack — `db`, `redis`, `api`, `worker`, `bot` — with no manual steps after setting `.env`. The `api` service runs `alembic upgrade head` before launching uvicorn.

## Testing

The suite lives in `tests/`; full setup notes in `tests/README.md`. Two layers:

- **unit** (`tests/test_*.py`) — no services. Encryption + key rotation, storage byte accounting, URL canonicalisation, SSRF guard, heuristics, signup guards, password/JWT primitives.
- **integration** (`tests/integration/`, `@pytest.mark.integration`) — the real app over `httpx.ASGITransport` against a real Postgres (pgvector) + Redis. Tenancy isolation, quotas, rate limits, storage deltas, account export/delete, semantic search.

```bash
python3.12 -m venv venv && source venv/bin/activate   # 3.13 has no wheels for asyncpg/pydantic-core at the pinned versions
pip install -r requirements.txt -r requirements-dev.txt
ruff check .
pytest                                    # integration layer skips if services are down
TEST_DATABASE_URL=… TEST_REDIS_URL=… pytest   # full run
```

Rules when adding tests:

- **Never mock what the test exists to verify.** Tenancy scoping, quotas and rate limits are enforced by SQL and Redis; assert against the real thing or the test proves nothing.
- **Quotas and limits default to `0`** (off/unlimited) in `conftest.py`. Opt in per test with `monkeypatch.setattr(settings, "MAX_LINKS_PER_USER", 3)` so every limit is asserted against a value that test set.
- **The suite must not touch the network.** The `no_network` fixture fails any real outbound HTTP request; patch `embed_text`/provider calls rather than letting them out.
- **Don't lower the event-loop scope.** `pytest.ini` pins session scope because the app's engine is created at import and its asyncpg connections bind to the creating loop.
- **`TEST_DATABASE_URL` must name a database ending in `_test`** — `conftest.py` refuses otherwise, because the suite `TRUNCATE`s every table between tests.
- **A new route that takes an id needs a cross-user 404 case** in `tests/integration/test_tenancy.py`. A new mutation site that writes link fields needs a delta case in `test_storage_deltas.py`.

CI (`.github/workflows/ci.yml`) runs ruff, the full suite against `pgvector/pgvector:pg16` + `redis:7` service containers with `ARCIV_REQUIRE_SERVICES=1` (so a dead service fails the build instead of skipping), and the SPA build. Python is pinned to **3.12** — matches the Dockerfile, and several pins have no 3.13 wheels.

## Working in this Repo

- **Shell is zsh** on macOS.
- **Migrations**: when you touch a model, add a new Alembic version under `db/migrations/versions/`. Don't edit existing migrations.
- **Async everywhere**: routers, DB sessions (`AsyncSessionLocal`), `httpx`, and ARQ jobs are all async. Avoid sync calls in request paths.
- **New ARQ jobs**: register the function in `worker/worker.py` `WorkerSettings.functions` or it will not run.
