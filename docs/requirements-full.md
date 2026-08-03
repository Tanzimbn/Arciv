# Arciv — System Requirements

> An open-source, self-hostable intelligent link and feed manager with AI-powered intent detection, automatic content classification, and semantic search.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Functional Requirements](#2-functional-requirements)
   - 2.1 [Push Flow — Manual Link Submission](#21-push-flow--manual-link-submission)
   - 2.2 [Pull Flow — Feed Tracker](#22-pull-flow--feed-tracker)
   - 2.3 [AI Agent Pipeline](#23-ai-agent-pipeline)
   - 2.4 [Smart Queues](#24-smart-queues)
   - 2.5 [Topic Explorer & Semantic Search](#25-topic-explorer--semantic-search)
   - 2.6 [Proactive Agent](#26-proactive-agent)
   - 2.7 [Knowledge Digest](#27-knowledge-digest)
   - 2.8 [Web UI](#28-web-ui)
   - 2.9 [Telegram Bot](#29-telegram-bot)
3. [Non-Functional Requirements](#3-non-functional-requirements)
   - 3.1 [Performance](#31-performance)
   - 3.2 [Scalability](#32-scalability)
   - 3.3 [Reliability](#33-reliability)
   - 3.4 [Security](#34-security)
   - 3.5 [Self-Hostability](#35-self-hostability)
4. [Technical Stack](#4-technical-stack)
5. [System Architecture](#5-system-architecture)
   - 5.1 [Components](#51-components)
   - 5.2 [Data Flow](#52-data-flow)
6. [Database Schema](#6-database-schema)
7. [API Specification](#7-api-specification)
8. [Feed Tracker Specification](#8-feed-tracker-specification)
9. [AI Agent Specification](#9-ai-agent-specification)
10. [Phase Roadmap](#10-phase-roadmap)
11. [Open Source Requirements](#11-open-source-requirements)
12. [Out of Scope (v1)](#12-out-of-scope-v1)

---

## 1. Project Overview

### Problem Statement

People save links constantly — from browsers, Telegram, newsletters, RSS feeds — but they never build into a usable knowledge base. Existing tools (Raindrop.io, Readwise Reader, Pocket) require manual tagging, are closed-source, and don't understand *what you should do* with a link or *when* to surface it again. Pocket shut down in July 2025 and Omnivore shut down in November 2024, leaving a significant gap for an open-source alternative.

### Solution

Arciv is a self-hostable web application where:

- Users submit any link (manually via web, or passively via RSS/Substack feed tracking)
- An AI agent automatically detects the content type, classifies the user's intent, summarises the content, and routes it to the correct queue
- A semantic search and topic clustering system surfaces related content across all saved items
- A proactive agent resurfaces stale or relevant content at the right time

**Deployment modes.** Arciv targets two first-class modes from the same codebase:

- **Self-hosted** (shipped) — `docker compose up`, single- or multi-user, operator controls everything.
- **Public hosted service** (planned) — a deployed instance anyone can sign up on, using their **own AI provider key** (BYOK) chosen from the providers the app offers. No per-user AI cost falls on the operator; the multi-tenant foundation (per-`user_id` isolation, encrypted keys, email verification) already exists. This mode adds a public-internet hardening layer — see §3.6.

### Goals

- **Learn by building**: the architecture deliberately exercises system design, agentic AI, scaling, and optimization
- **Solve a real problem**: replace dead/closed tools with a privacy-respecting, self-hostable alternative
- **Open source**: full code on GitHub, MIT licensed, Docker-first deployment

---

## 2. Functional Requirements

### 2.1 Push Flow — Manual Link Submission

**FR-P-01**: Users must be able to submit a URL via the web app by pasting into an input field.

**FR-P-02**: Users must be able to submit a URL via a browser extension (Chrome/Firefox) with a single click.

**FR-P-03**: Users must be able to submit a URL via the Telegram bot by forwarding a shared link from any mobile browser.

**FR-P-04**: Users must be able to submit a URL via a REST API (`POST /api/links`) for third-party integrations.

**FR-P-05**: The system must deduplicate submitted links per user — submitting the same URL twice must not create a duplicate entry; instead it should notify the user that this link already exists and show its current status.

**FR-P-06**: The system must validate that a submitted URL is reachable before processing. Unreachable URLs must be stored with status `unreachable` and the user notified.

**FR-P-07**: The system must resolve and store the canonical URL (following redirects, removing tracking parameters like `utm_source`).

---

### 2.2 Pull Flow — Feed Tracker

**FR-F-01**: Users must be able to add a feed source by submitting any of the following:
  - A direct RSS/Atom feed URL (e.g. `https://blog.example.com/feed`)
  - A webpage URL — the system auto-discovers the feed via `<link rel="alternate" type="application/rss+xml">` in the HTML
  - A Substack publication URL (e.g. `https://name.substack.com`) — the system appends `/feed` automatically

**FR-F-02**: The system must poll all active feeds on a configurable schedule (default: every 30 minutes).

**FR-F-03**: The system must use `ETag` and `Last-Modified` HTTP headers to avoid re-downloading unchanged feeds (conditional GET).

**FR-F-04**: The system must diff each fetched feed against previously seen item GUIDs and process only new items.

**FR-F-05**: New feed items must enter the same shared job queue as manually submitted links and be processed by the same AI agent pipeline.

**FR-F-06**: Users must be able to pause, resume, and delete individual feed sources from the Feed Manager UI.

**FR-F-07**: The system must display feed health metrics per source: last polled timestamp, number of new items in the last 30 days, and average user engagement rate (items read / items received).

**FR-F-08**: If a feed fails to fetch for 7 consecutive polling cycles, its status must be set to `degraded` and the user notified.

**FR-F-09**: If a feed returns HTTP 410 Gone or has had zero new items for 90 days, the system must suggest removal to the user.

---

### 2.3 AI Agent Pipeline

All items — whether from push or pull flow — must pass through this pipeline after entering the job queue.

**FR-A-01 — Content type detection**: The agent must classify each item into one of the following content types:
  - `video` (YouTube, Vimeo, Loom, etc.)
  - `article` (blog post, news, essay)
  - `research-paper` (arXiv, PDF academic paper)
  - `tool` (product page, GitHub repo, SaaS app)
  - `podcast` (audio episode page)
  - `newsletter` (Substack, email web version)
  - `documentation` (official docs, wikis)
  - `other`

**FR-A-02 — Intent classification**: Based on content type and content, the agent must assign a queue intent:
  - `watch-later` — for videos and recorded talks
  - `read-later` — for articles, papers, newsletters
  - `try-later` — for tools, repos, products
  - `reference` — for documentation, evergreen resources

**FR-A-03 — Summarisation**: The agent must generate a 2–4 sentence plain-language summary of each item's content.

**FR-A-04 — Tagging**: The agent must extract 3–7 topic tags per item (e.g. `machine-learning`, `system-design`, `startup`).

**FR-A-05 — Difficulty estimation**: For articles and papers, the agent must estimate reading difficulty: `beginner`, `intermediate`, `advanced`.

**FR-A-06 — Embedding**: The agent must generate a vector embedding of each item (title + summary + tags) and store it in pgvector for semantic search and similarity.

**FR-A-07 — Reading time estimation**: For text content, the system must estimate reading time in minutes based on word count (average 200 wpm).

**FR-A-08 — Failure handling**: If the AI agent fails to process an item (API error, timeout), the job must be retried up to 3 times with exponential backoff. After 3 failures, the item is stored with status `processing-failed` and the user is notified.

**FR-A-09 — LLM provider agnosticism**: The AI pipeline must support pluggable LLM backends via a provider interface. The default provider is Anthropic Claude. The system must also support OpenAI and local Ollama models via environment configuration.

---

### 2.4 Smart Queues

**FR-Q-01**: Each processed item must be placed in exactly one of four queues based on intent: Watch-later, Read-later, Try-later, Reference.

**FR-Q-02**: Users must be able to manually move an item between queues.

**FR-Q-03**: Each queue must support sorting by: date added (default), estimated reading/watch time, AI-assigned relevance score.

**FR-Q-04**: Users must be able to mark an item as `done` (read/watched/tried) which removes it from the active queue into an archive.

**FR-Q-05**: Users must be able to mark an item as `skipped` — it leaves the active queue but remains searchable.

**FR-Q-06**: Each queue must display an estimated total time to completion (sum of all item reading/watch times).

---

### 2.5 Topic Explorer & Semantic Search

**FR-S-01**: The system must display a topic cluster view — a grouped list of all topics extracted from the user's saved items, ordered by number of items per topic.

**FR-S-02**: Clicking a topic must show all items tagged with that topic, across all queues and sources.

**FR-S-03**: Each item detail view must show a "Similar items" panel: the top 5 semantically similar items from the user's library, found via pgvector cosine similarity on embeddings.

**FR-S-04**: The search bar must support natural language queries (e.g. "that article about React performance" or "videos on distributed systems"). Results are ranked by vector similarity to the query embedding, not keyword match.

**FR-S-05**: Search must work across all item fields: title, summary, tags, source name, and URL domain.

**FR-S-06**: Search results must be filterable by: content type, queue, source, date range, read status.

---

### 2.6 Proactive Agent

**FR-PA-01**: The system must run a daily background job per user that analyses queue state and triggers nudges.

**FR-PA-02 — Stale item nudge**: If an item has been in the queue for more than 14 days without being read, the agent must resurface it with a freshness check ("Still relevant? Here's a summary.").

**FR-PA-03 — Streak nudge**: If the user has not marked any item as done for 7 days, the agent must suggest the shortest unread item in the queue.

**FR-PA-04 — Dead link detection**: The agent must periodically re-check saved URLs (monthly) for HTTP errors and notify the user of any broken links.

**FR-PA-05 — Smart unsubscribe**: If a feed source has delivered 15+ items and the user engagement rate (items marked done / items delivered) is below 10%, the system must suggest pausing or removing that feed.

**FR-PA-06 — Knowledge gap detection**: If the user's topic clusters show heavy saving in one topic but no engagement (zero items marked done), the agent must surface the most beginner-friendly item in that topic cluster.

All nudges must be dismissable and configurable — users must be able to disable any nudge type individually.

---

### 2.7 Knowledge Digest

**FR-D-01**: The system must generate a weekly digest per user, delivered as an in-app notification and optionally via email.

**FR-D-02**: The digest must include: a summary of items the user engaged with that week, top topics by save count, and one AI-generated insight connecting themes across saved content.

**FR-D-03**: Users must be able to opt out of the digest or change delivery frequency (weekly / off).

---

### 2.8 Web UI

**FR-UI-01**: The web app must be a single-page application (SPA) with the following views:
  - **Inbox** — newly processed items, not yet sorted into a queue
  - **Queues** — tabbed view of Watch-later / Read-later / Try-later / Reference
  - **Feed Manager** — list of tracked feed sources with health metrics
  - **Topic Explorer** — topic cluster grid + similar items
  - **Search** — full-library natural language search
  - **Archive** — completed and skipped items
  - **Settings** — LLM provider config, notification preferences, account

**FR-UI-02**: The UI must be responsive — usable on both desktop and tablet screen sizes.

**FR-UI-03**: The UI must support light and dark mode.

**FR-UI-04**: All queue views must support infinite scroll (pagination via cursor, not page numbers).

**FR-UI-05**: The link submission input must be accessible from every view via a persistent floating button or top bar shortcut.

---

### 2.9 Telegram Bot

**FR-T-01**: Users must be able to link their Telegram account to their Arciv account via a one-time token flow from the Settings page.

**FR-T-02**: Once linked, forwarding any message containing a URL to the bot must submit that URL to the user's Arciv account via the push flow.

**FR-T-03**: The bot must reply with a confirmation message containing: the detected content type, assigned queue, and a 1-sentence summary — within 30 seconds of submission.

**FR-T-04**: The bot must handle the case where a message contains multiple URLs — each URL must be submitted as a separate item.

---

## 3. Non-Functional Requirements

### 3.1 Performance

**NFR-PERF-01**: The API must respond to link submission requests within 200ms (excluding the async AI processing job).

**NFR-PERF-02**: AI processing of a single item (content fetch + LLM classification + embedding) must complete within 30 seconds under normal load.

**NFR-PERF-03**: Search queries must return results within 500ms for libraries up to 10,000 items.

**NFR-PERF-04**: The feed poller must be able to poll 500 active feeds within a single 30-minute polling cycle.

**NFR-PERF-05**: The web UI must achieve a Lighthouse performance score of ≥ 85 on desktop.

---

### 3.2 Scalability

**NFR-SCALE-01**: The job queue must support horizontal scaling — multiple worker processes must be able to consume from the same queue without duplicate processing (using BullMQ's atomic job locking).

**NFR-SCALE-02**: The feed poller must support fan-out — feeds can be polled in parallel with a configurable concurrency limit (default: 20 concurrent feed fetches).

**NFR-SCALE-03**: The database schema must support multi-user operation from day one (all tables scoped by `user_id`), even if the initial deployment is single-user.

**NFR-SCALE-04**: Vector similarity search (pgvector) must remain under 500ms for up to 50,000 vectors per user with an IVFFlat index.

---

### 3.3 Reliability

**NFR-REL-01**: Failed jobs must be retried automatically with exponential backoff (3 attempts, delays: 30s, 2min, 10min).

**NFR-REL-02**: The system must not lose a submitted link — if the AI pipeline fails, the raw link must still be stored with status `pending` and retried.

**NFR-REL-03**: Feed polling failures must not cascade — a single feed timing out must not block other feeds from being polled.

**NFR-REL-04**: The system must expose a health check endpoint (`GET /health`) that verifies DB connectivity, Redis connectivity, and queue worker liveness.

---

### 3.4 Security

**NFR-SEC-01**: All API endpoints must require authentication (JWT bearer token).

**NFR-SEC-02**: User data must be strictly isolated — queries must always be scoped to the authenticated user's `user_id`; no cross-user data access is permitted.

**NFR-SEC-03**: User-supplied LLM API keys (BYOK) are stored **encrypted at rest** (AES-256 via `ENCRYPTION_KEY`), never returned to the client (masked only), and never committed to version control. An optional operator-level shared key may live in env for the free tier. *(Superseded the original env-only rule once per-user BYOK landed.)*

**NFR-SEC-04**: The Telegram bot webhook must validate the `X-Telegram-Bot-Api-Secret-Token` header on every incoming request.

**NFR-SEC-05**: URL submissions must be validated against a blocklist of known malicious domains (using a community-maintained list) before processing.

**NFR-SEC-06**: Rate limiting must be applied to the submission API: max 60 link submissions per user per hour.

---

### 3.5 Self-Hostability

**NFR-HOST-01**: The entire system must be deployable with a single `docker compose up` command.

**NFR-HOST-02**: All configuration (LLM provider, API keys, DB credentials, polling interval) must be managed via environment variables in a `.env` file.

**NFR-HOST-03**: The system must ship with database migration tooling (e.g. Alembic or Flyway) so schema changes can be applied without data loss.

**NFR-HOST-04**: The system must support full data export to JSON at any time via `GET /api/export`.

**NFR-HOST-05**: The Docker images must be published to GitHub Container Registry (ghcr.io) on every tagged release.

---

### 3.6 Public Hosted Operation (planned)

Requirements specific to running Arciv as a **public, multi-tenant hosted service** where any visitor can self-register and use it with their own AI provider key. These sit on top of the existing tenancy foundation (per-`user_id` isolation, AES-256 key encryption, email verification, SSRF guard on outbound fetches, auth-route rate limiting).

> **Status (2026-08-03): the NFR-PUB hardening layer has shipped** on `feat/public-launch-hardening`. PUB-01 through PUB-07 are done, including PUB-03 (per-account storage-bytes cap via `MAX_STORAGE_BYTES_PER_USER` + running `users.storage_bytes`) and PUB-04 signup captcha (Cloudflare Turnstile), plus guided BYOK onboarding (first-login prompt + banner). All pre-launch items are now shipped. See the "Public hosted launch" roadmap block in §10 for the per-item state.

**NFR-PUB-01 (BYOK)**: Every user brings their own AI provider key, selected from the app's offered providers. The service must run with **zero per-user AI cost to the operator**; the optional shared free-tier key stays capped per user per day.

**NFR-PUB-02 (rate limiting everywhere)**: Rate limiting must extend beyond auth routes to all state-changing and compute-heavy endpoints — at minimum `POST /api/links` and `GET /api/links/search` (each search runs a server-side embedding). Limits are per user and per IP.

**NFR-PUB-03 (resource quotas)**: Each account must have enforced ceilings — max links, max feeds, and total storage — to prevent a single user from exhausting shared capacity. *(Shipped: `MAX_LINKS_PER_USER` + `MAX_FEEDS_PER_USER` count caps and `MAX_STORAGE_BYTES_PER_USER` byte cap in `api/config.py`. Count caps enforced in `POST /api/links` / `POST /api/feeds`; the storage cap is soft-enforced at link-create against a running `users.storage_bytes` total maintained by `api/utils/storage.py` across create/update/delete + the AI classify/embed workers.)*

**NFR-PUB-04 (registration abuse)**: Open signup must be protected against automated/disposable-email abuse (throttling and/or captcha) beyond the existing per-IP register cap. *(Shipped: per-IP register cap + `BLOCK_DISPOSABLE_EMAILS` + `SIGNUPS_PER_DAY_GLOBAL`, plus Cloudflare Turnstile captcha — `TURNSTILE_SECRET_KEY`/`TURNSTILE_SITE_KEY`, verified in `POST /api/auth/register`, off by default for self-host.)*

**NFR-PUB-05 (key custody)**: Holding many users' provider keys requires envelope encryption and a documented `ENCRYPTION_KEY` rotation path, so key rotation does not force every user to re-enter their key at once.

**NFR-PUB-06 (embedding-load isolation)**: Server-side embedding (save + search) must be bounded — a concurrency cap or a dedicated embedding service — so search load cannot starve API request handling.

**NFR-PUB-07 (legal & lifecycle)**: The hosted service must publish Terms of Service and a privacy policy, and provide self-serve data export (`GET /api/export`) and full account deletion.

---

## 4. Technical Stack

| Layer | Technology | Rationale |
|---|---|---|
| Backend API | Python (FastAPI) | Async-first, great typing, easy LLM SDK integration |
| Job queue | BullMQ (Redis-backed) | Battle-tested, supports retries, delays, priorities |
| Primary database | PostgreSQL 16 | Relational + pgvector extension for embeddings |
| Vector search | pgvector | Native Postgres extension — no separate vector DB needed |
| Cache | Redis 7 | Queue backend + API response caching |
| AI provider (default) | Anthropic Claude API | Tool-calling support for agentic pipeline |
| Embedding model | `text-embedding-3-small` (OpenAI) or `nomic-embed-text` (Ollama) | Configurable |
| Frontend | React + Vite + TailwindCSS | SPA, fast build, utility-first styling |
| Feed parsing | `feedparser` (Python) | Handles RSS 1.0, RSS 2.0, Atom |
| HTML scraping | `httpx` + `beautifulsoup4` | Fetch page content + auto-discover feed URLs |
| Telegram bot | `python-telegram-bot` | Async, webhook-compatible |
| Containerisation | Docker + Docker Compose | Single-command self-hosting |
| Database migrations | Alembic | Version-controlled schema changes |
| Auth | JWT (via `python-jose`) + bcrypt passwords | Stateless, self-hosted friendly |

---

## 5. System Architecture

### 5.1 Components

```
Arciv/
├── api/                  # FastAPI application
│   ├── routers/          # links, feeds, search, auth, digest, export
│   ├── models/           # SQLAlchemy ORM models
│   ├── schemas/          # Pydantic request/response schemas
│   └── middleware/       # Auth, rate limiting, logging
├── agent/                # AI agent pipeline
│   ├── pipeline.py       # Orchestrator: fetches, classifies, embeds
│   ├── detector.py       # Content type detection
│   ├── classifier.py     # Intent classification
│   ├── summariser.py     # Summarisation + tagging
│   ├── embedder.py       # Vector embedding generation
│   └── providers/        # LLM provider adapters (Anthropic, OpenAI, Ollama)
├── worker/               # BullMQ job consumers
│   ├── link_worker.py    # Processes items from the shared queue
│   └── feed_worker.py    # Polls RSS feeds on schedule
├── bot/                  # Telegram bot
│   └── handler.py        # Message handler → API bridge
├── db/
│   └── migrations/       # Alembic migration files
├── frontend/             # React SPA
│   ├── src/
│   │   ├── views/        # Inbox, Queues, Feeds, Search, Archive, Settings
│   │   ├── components/   # LinkCard, FeedRow, TopicCluster, SearchBar
│   │   └── api/          # Typed API client
│   └── vite.config.ts
├── docker-compose.yml
├── .env.example
└── README.md
```

### 5.2 Data Flow

**Push flow:**
```
User submits URL
  → API validates + deduplicates
  → Canonical URL resolved
  → Job pushed to Redis queue (status: pending)
  → Worker picks up job
  → Agent: fetch page content
  → Agent: detect content type
  → Agent: classify intent
  → Agent: summarise + tag
  → Agent: generate embedding → pgvector
  → Link stored in PostgreSQL (status: processed)
  → User notified (in-app)
```

**Pull flow:**
```
Cron job fires every 30 min
  → Feed worker fetches each active feed (conditional GET)
  → Diff against seen GUIDs
  → New items → same Redis queue as push flow
  → Same agent pipeline processes each item
  → Items stored linked to their feed source
```

---

## 6. Database Schema

### `users`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `email` | `varchar(255)` UNIQUE | |
| `password_hash` | `varchar(255)` | bcrypt |
| `telegram_chat_id` | `bigint` NULLABLE | linked Telegram account |
| `llm_provider` | `varchar(50)` | `anthropic` \| `openai` \| `ollama` |
| `llm_api_key_enc` | `text` NULLABLE | encrypted at rest |
| `digest_enabled` | `boolean` | default true |
| `created_at` | `timestamptz` | |

### `links`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK → users | |
| `feed_id` | `uuid` FK → feeds NULLABLE | null if manually submitted |
| `url` | `text` | canonical URL |
| `title` | `text` NULLABLE | extracted from page |
| `content_type` | `varchar(50)` | `video`, `article`, `tool`, etc. |
| `intent` | `varchar(50)` | `watch-later`, `read-later`, etc. |
| `summary` | `text` NULLABLE | AI-generated |
| `tags` | `text[]` | AI-extracted |
| `difficulty` | `varchar(20)` NULLABLE | `beginner`, `intermediate`, `advanced` |
| `reading_time_min` | `integer` NULLABLE | estimated |
| `status` | `varchar(30)` | `pending`, `processed`, `done`, `skipped`, `failed`, `unreachable` |
| `embedding` | `vector(1536)` | pgvector |
| `submitted_at` | `timestamptz` | |
| `processed_at` | `timestamptz` NULLABLE | |
| `done_at` | `timestamptz` NULLABLE | |

### `feeds`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK → users | |
| `site_url` | `text` | the webpage URL user provided |
| `feed_url` | `text` | resolved RSS/Atom URL |
| `title` | `varchar(255)` | feed display name |
| `status` | `varchar(20)` | `active`, `paused`, `degraded` |
| `last_polled_at` | `timestamptz` NULLABLE | |
| `last_etag` | `text` NULLABLE | for conditional GET |
| `last_modified` | `text` NULLABLE | for conditional GET |
| `poll_failures` | `integer` | consecutive failure count |
| `created_at` | `timestamptz` | |

### `jobs` (audit log)
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `link_id` | `uuid` FK → links | |
| `status` | `varchar(20)` | `queued`, `processing`, `done`, `failed` |
| `attempt` | `integer` | 1-indexed retry count |
| `error_message` | `text` NULLABLE | |
| `created_at` | `timestamptz` | |
| `completed_at` | `timestamptz` NULLABLE | |

---

## 7. API Specification

### Authentication

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Create account |
| `POST` | `/api/auth/login` | Returns JWT |
| `POST` | `/api/auth/telegram/link` | Returns one-time Telegram link token |

### Links

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/links` | Submit a URL (push flow) |
| `GET` | `/api/links` | List links (filterable by queue, status, type, tag) |
| `GET` | `/api/links/:id` | Get single link with similar items |
| `PATCH` | `/api/links/:id` | Update status (done, skipped, move queue) |
| `DELETE` | `/api/links/:id` | Remove a link |
| `GET` | `/api/links/:id/similar` | Top 5 semantically similar items |

### Feeds

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/feeds` | Add a feed source |
| `GET` | `/api/feeds` | List all feeds with health metrics |
| `PATCH` | `/api/feeds/:id` | Pause / resume a feed |
| `DELETE` | `/api/feeds/:id` | Remove a feed (items are kept) |
| `POST` | `/api/feeds/:id/poll` | Manually trigger a poll |

### Search

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/search?q=` | Natural language search (vector similarity) |
| `GET` | `/api/topics` | List all topic clusters with counts |

### Export & Health

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/export` | Full data export as JSON |
| `GET` | `/health` | System health check |

---

## 8. Feed Tracker Specification

### Feed Auto-Discovery Algorithm

```
Input: URL provided by user

1. If URL ends with /feed, /rss, /rss.xml, /atom.xml → use directly
2. If URL is a Substack domain → append /feed
3. Else:
   a. Fetch the page HTML (HEAD first, then GET if needed)
   b. Parse <link rel="alternate" type="application/rss+xml" href="...">
   c. If found → use that href (resolve relative URLs)
   d. If not found → try common paths: /feed, /rss, /rss.xml, /atom.xml
   e. If none work → return error: "No feed found at this URL"
```

### Polling Logic

```
Every 30 minutes (configurable via FEED_POLL_INTERVAL_MINUTES env var):

For each feed where status = 'active':
  1. Send conditional GET with If-None-Match (etag) and If-Modified-Since headers
  2. If 304 Not Modified → skip, update last_polled_at
  3. If 200 OK:
     a. Parse RSS/Atom XML with feedparser
     b. Extract all item GUIDs
     c. Query DB for existing GUIDs for this feed
     d. Diff → new_items = fetched_guids - existing_guids
     e. For each new item → push to job queue
     f. Update feed: last_polled_at, last_etag, last_modified, reset poll_failures
  4. If error (timeout, 5xx, DNS fail):
     a. Increment poll_failures
     b. If poll_failures >= 7 → set status = 'degraded', notify user
```

---

## 9. AI Agent Specification

### Tool Definitions (for agentic pipeline)

The agent is given the following tools which it can call against the system:

```python
tools = [
    {
        "name": "fetch_page_content",
        "description": "Fetches the text content and metadata of a URL",
        "input_schema": {"url": "string"}
    },
    {
        "name": "classify_content",
        "description": "Given page content, returns content_type and intent",
        "input_schema": {"title": "string", "content": "string", "url": "string"}
    },
    {
        "name": "generate_summary",
        "description": "Generates a 2-4 sentence summary and 3-7 topic tags",
        "input_schema": {"title": "string", "content": "string"}
    }
]
```

### Classification Prompt Template

```
You are a content classification agent for a personal knowledge management system.

Given the following web page:
URL: {url}
Title: {title}
Content excerpt: {content[:2000]}

Respond with a JSON object containing:
- content_type: one of [video, article, research-paper, tool, podcast, newsletter, documentation, other]
- intent: one of [watch-later, read-later, try-later, reference]
- summary: 2-4 sentence plain-language summary
- tags: array of 3-7 lowercase topic tags (e.g. ["machine-learning", "python", "system-design"])
- difficulty: one of [beginner, intermediate, advanced] — only for article, research-paper; null otherwise
- reading_time_min: estimated integer minutes for text content; null for video/tool

Classification rules:
- YouTube, Vimeo, Loom → video → watch-later
- GitHub repos, product pages, SaaS tools → tool → try-later
- API docs, official documentation → documentation → reference
- arXiv, PDF with abstract → research-paper → read-later
- Substack posts, blog posts → article or newsletter → read-later
- Podcast episode pages → podcast → watch-later
```

---

## 10. Phase Roadmap

> **Status (2026-08-02).** Phases 1–2 have shipped (on ARQ, not BullMQ — see §4).
> Auth was hardened beyond the original scope (email verification, refresh-token
> rotation, password reset, rate limiting) and an **admin monitoring panel**
> (daily traffic, unique visitors, signups via Redis aggregate counters) landed
> ahead of Phase 5. **Embeddings now exist** (local fastembed, migration
> `0012_link_embedding`, optional `embed-service/` microservice) and **semantic
> search has shipped end-to-end** — `GET /api/links/search` plus the search box
> in `LinksView`. The **"Public hosted launch" hardening layer has also shipped**
> (see block below and §3.6). Remaining Phase 3 work is the rest of the discovery
> surface: **similar-items panel and topic explorer**, both not yet built. Phase 4
> (proactive resurface + weekly digest) follows.

### Phase 1 — Core pipeline ✅ shipped
**Goal**: A working end-to-end system. Submit a link, get it classified and queued.

- [ ] Project scaffolding: FastAPI + PostgreSQL + Redis via Docker Compose
- [ ] User auth (register, login, JWT)
- [ ] `POST /api/links` endpoint with URL validation + dedup
- [ ] BullMQ worker consuming from the link queue
- [ ] AI agent: content fetch + classify + summarise (Anthropic Claude)
- [ ] pgvector setup + embedding generation
- [ ] Basic web UI: link submission input + queue list view
- [ ] Telegram bot: receive URL → submit to API → reply with summary

**Milestone**: User can paste a link on the web or forward it on Telegram, and see it appear in the correct queue with a summary within 30 seconds.

---

### Phase 2 — Feed tracker ✅ shipped (notification-only)
**Goal**: Passive content collection from RSS/Substack sources.
**Deviation**: feeds are notification-only — subscribing seeds GUIDs and the daily
poll emits one grouped notification per feed; no auto-ingest of `Link` rows. The
user saves what they want via `POST /api/links`.

- [ ] `feeds` table + Alembic migration
- [ ] Feed auto-discovery algorithm
- [ ] BullMQ repeatable job for feed polling (every 30 min)
- [ ] Conditional GET with ETag/Last-Modified
- [ ] Feed health metrics (poll_failures, engagement rate)
- [ ] Feed Manager UI: add/pause/remove feeds, view health
- [ ] Feed items flow through same AI agent as push links

**Milestone**: User can subscribe to 10 RSS feeds and wake up each morning with new posts automatically classified and queued.

---

### Phase 3 — Semantic search & topic explorer 🚧 partly shipped
**Goal**: Make the saved library discoverable and connected. **Foundation step:
generate an embedding per link at save time — the substrate for search,
similar-items, dedup, and clustering. Shipped** (local fastembed model, stored on
`links.embedding`, migration `0012_link_embedding`; optional `embed-service/`).

- [x] Embedding generated per link at save time (`agent/embedding.py`, worker `embed.py`)
- [x] Natural language search endpoint with embedding-based ranking (`GET /api/links/search`)
- [x] Search UI — semantic search box in `LinksView` (`api.searchLinks`, debounced)
- [ ] Similar items panel on each link detail view (⭐ next — `LinkDetailDrawer.jsx` exists, add `GET /api/links/:id/similar`)
- [ ] Topic cluster view (group by `ai_tags`, show counts; `GET /api/topics`)
- [ ] Search filters (type, queue, date, source)

> Note: search ranks by cosine similarity over stored embeddings via a linear scan
> per user — no IVFFlat index yet. Fine at MVP scale; add the index when per-user
> libraries grow large.

**Milestone**: User can type "that article about Go concurrency" into search and find it instantly, even without remembering the title.

---

### Phase 4 — Proactive agent & digest (after Phase 3)
**Goal**: The system becomes an active partner, not a passive archive. `worker/
daily_digest.py` is already scaffolded; the work is AI-ranking the backlog to
resurface forgotten-but-relevant items.

- [ ] Daily background job per user (BullMQ delayed jobs)
- [ ] Stale item nudge (14-day resurface)
- [ ] Dead link re-checker (monthly)
- [ ] Smart unsubscribe suggestion (low engagement feeds)
- [ ] Knowledge gap detection
- [ ] Weekly digest generation + in-app delivery
- [ ] Optional email digest via SMTP

**Milestone**: Without any action from the user, the system surfaces a forgotten but relevant article and the user marks it as done.

---

### Phase 5 — Optimisation & polish (ongoing)
**Goal**: Production-ready performance and developer experience.

- [ ] Redis caching for frequent API queries
- [x] Rate limiting middleware (slowapi + Redis; auth + link-save limits)
- [ ] API response time profiling + slow query analysis
- [ ] Lighthouse performance audit + fixes
- [x] Full data export endpoint (`GET /api/account/export`)
- [x] GitHub Actions CI: lint, test, build, push Docker image to ghcr.io
- [x] Comprehensive README with self-hosting guide
- [x] Admin monitoring panel — daily traffic, unique visitors, signups (Redis counters)

---

### Public hosted launch — turn the self-host app into a public multi-tenant service (planned)
**Goal**: let anyone sign up on a deployed instance and use it with their own AI provider key, without self-hosting. This is a hardening/ops layer on top of the shipped app (see §3.6), not new product surface. **Mostly shipped as of 2026-08-03** on `feat/public-launch-hardening`.

- [x] Rate limiting on `POST /api/links` and `GET /api/links/search` (per-user, per-minute) — NFR-PUB-02 (`LINKS_CREATE_PER_MINUTE`, `SEARCH_PER_MINUTE`, `INSIGHTS_PER_MINUTE`)
- [x] Per-user resource quotas — NFR-PUB-03: link + feed count caps (`MAX_LINKS_PER_USER`, `MAX_FEEDS_PER_USER`) + per-account storage-bytes cap (`MAX_STORAGE_BYTES_PER_USER`, running `users.storage_bytes`, `api/utils/storage.py`)
- [x] Registration-abuse controls — NFR-PUB-04: disposable-email block (`BLOCK_DISPOSABLE_EMAILS`) + per-IP signup guards + Cloudflare Turnstile captcha (`TURNSTILE_SECRET_KEY`/`TURNSTILE_SITE_KEY`, off by default)
- [x] Key-custody hardening: envelope encryption + `ENCRYPTION_KEY` rotation path — NFR-PUB-05
- [x] Bounded server-side embedding — NFR-PUB-06: `EMBEDDING_MAX_CONCURRENCY` semaphore + Redis query-embed cache + optional `embed-service/` microservice (`EMBED_SERVICE_URL`)
- [x] Legal + lifecycle: ToS, privacy policy, data export, account deletion — NFR-PUB-07 (`docs/legal/`, `GET /api/account/export`, `DELETE /api/account`)
- [x] Provider-key onboarding UX — BYOK in Settings (provider select + key + test-connection) **and** guided onboarding: first-login modal + dismissible banner (`components/ByokOnboarding.jsx`), shown only when the user has no personal key and the instance has no shared key (`SettingsResponse.shared_ai_available`)

**Milestone**: a stranger can register on the public URL, paste their own Gemini/OpenAI key, save links, and search — with abuse controls and quotas making that safe to leave open to the internet. **Met** — the safety layer and guided BYOK onboarding are both shipped; nothing pre-launch remains.

---

## 11. Open Source Requirements

- **License**: MIT
- **Repository structure**: monorepo at `github.com/{username}/Arciv`
- **`.env.example`**: must document every environment variable with description and example value
- **`docker-compose.yml`**: must bring up the full stack (api, worker, bot, postgres, redis) with one command
- **`README.md`**: must include: project description, architecture diagram, quickstart guide, environment variable reference, contributing guide
- **GitHub Issues**: use issues for all feature tracking; label with `phase-1` through `phase-5`
- **Releases**: tag each phase completion as a GitHub Release with changelog
- **Contributing**: include `CONTRIBUTING.md` with code style guide, PR process, and local dev setup

---

## 12. Out of Scope (v1)

The following features are explicitly deferred to future versions to keep v1 focused. Note: running as a **public multi-tenant hosted service** is now an active direction (§3.6) — but that means many independent single-user tenants, *not* the shared/team features below (team workspaces, collaboration, public developer API remain out of scope).

- Native mobile apps (iOS/Android) — Telegram bot covers mobile use case
- Social features (sharing collections, following other users)
- Browser reading mode / distraction-free reader view
- Highlights and annotations within articles
- Spaced repetition / flashcard system for saved content
- Public API for third-party developers
- Zapier / Make.com integrations
- Multi-workspace / team accounts
- AI-generated podcast audio of weekly digest
- Chrome extension (Phase 1 uses Telegram + web paste; extension added later)