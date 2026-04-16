# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Arciv** is a self-hostable intelligent link and feed manager. Users save URLs manually or via RSS feeds; an AI pipeline classifies, summarises, and routes them into smart queues. Week 1 (foundation) is complete — code lives at project root. Docs in `docs/`.

Build the MVP first (`docs/requirements-mvp.md`), then extend toward the full spec (`docs/requirements-full.md`).

## Planned Tech Stack

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
arciv/  (project root — /Documents/projects/Arciv/)
├── api/                        # FastAPI application
│   ├── routers/                # auth.py (done); links, feeds, notifications, settings (pending)
│   ├── models/                 # user.py, link.py (done); feeds, notifications (pending)
│   ├── schemas/                # auth.py (done)
│   ├── middleware/             # auth.py — JWT get_current_user (done)
│   ├── utils/                  # security.py — bcrypt hash/verify (done)
│   ├── config.py               # Pydantic settings from .env (done)
│   ├── database.py             # Async SQLAlchemy engine + get_db (done)
│   └── main.py                 # FastAPI app + /health endpoint (done)
├── agent/                      # AI processing pipeline (Week 3)
│   └── providers/              # LLM adapters — Gemini, Groq, Anthropic, OpenAI, Ollama
├── worker/                     # ARQ job consumers (Week 3)
├── bot/                        # Telegram bot (Week 5)
├── db/
│   └── migrations/
│       ├── env.py              # Async Alembic env (done)
│       ├── script.py.mako
│       └── versions/
│           └── 0001_initial_users_links.py  # users + links tables (done)
├── frontend/                   # React SPA (Week 2)
│   └── src/
│       ├── views/
│       └── components/
├── alembic.ini                 # (done)
├── docker-compose.yml          # PostgreSQL 16 + Redis 7 + api (done)
├── Dockerfile                  # (done)
├── requirements.txt            # (done)
├── .env.example                # (done)
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

**API keys encrypted at rest.** `ai_api_key_enc` in the DB uses AES-256. Keys are never returned in API responses — only a masked version (`sk-...****`).

## MVP Build Order

Follow this sequence (each step is independently usable):

1. **Foundation** — Docker Compose (PostgreSQL + Redis + FastAPI skeleton), Alembic migrations for `users` + `links`, JWT auth, `/health` endpoint
2. **Link saving** — `POST /api/links` (metadata fetch, URL canonicalisation, dedup), `GET /api/links`, `PATCH` (mark done), basic React UI
3. **AI pipeline** — ARQ queue, provider implementations starting with Gemini free tier, classify+summarise in single LLM call, exponential backoff retry, Settings page
4. **Feed tracker** — `feeds` + `feed_items` + `notifications` tables, RSS auto-discovery, daily cron poll, failure handling
5. **Notifications + Telegram** — in-app notification bell, Telegram bot linking + URL submission + daily digest

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
PATCH  /api/feeds/:id          # pause/resume
DELETE /api/feeds/:id
POST   /api/feeds/:id/check-now

GET    /api/notifications
POST   /api/notifications/read-all

GET    /api/settings
PATCH  /api/settings
POST   /api/settings/ai/test

GET    /health
```

## Database Key Constraints

- `links` has `UNIQUE (user_id, canonical_url)` — deduplication is at the DB level
- `feed_items` has `UNIQUE (feed_id, guid)` — prevents duplicate RSS imports
- URL canonicalisation: follow all redirects, strip `utm_*`, `fbclid`, `gclid`, `ref` params, normalise trailing slash

## Environment Configuration

All config via `.env`. An `.env.example` must document every variable. Key variables will include: `DATABASE_URL`, `REDIS_URL`, `SECRET_KEY` (JWT), `ENCRYPTION_KEY` (AES-256 for API keys), `TELEGRAM_BOT_TOKEN`, `SHARED_GEMINI_KEY`, `FEED_POLL_CRON`.

## Self-Hosting Requirement

`docker compose up` must start the full stack with no manual steps after setting `.env`.
