# Arciv — MVP System Requirements

> Focus: Ship the smallest useful version. Three core features, done well.

---

## What this MVP does

1. **You paste a link → it gets saved, classified, and summarised**
2. **AI works when available, system still works when it doesn't**
3. **You subscribe to blogs → system checks daily and notifies you of new posts**

Everything else is out of scope for v1.

---

## Table of Contents

1. [Core Features](#1-core-features)
   - 1.1 [Manual Link Saving](#11-manual-link-saving)
   - 1.2 [AI Processing — with graceful degradation](#12-ai-processing--with-graceful-degradation)
   - 1.3 [Daily Blog / Feed Tracker](#13-daily-blog--feed-tracker)
2. [Non-Functional Requirements](#2-non-functional-requirements)
3. [Technical Stack](#3-technical-stack)
4. [Database Schema](#4-database-schema)
5. [AI Provider Strategy](#5-ai-provider-strategy)
6. [API Endpoints](#6-api-endpoints)
7. [What is NOT in MVP](#7-what-is-not-in-mvp)
8. [Build Order](#8-build-order)

---

## 1. Core Features

---

### 1.1 Manual Link Saving

The primary user action: paste a URL into the web app and have it stored and processed.

#### User story
> As a user, I open Arciv in my browser, paste a URL from anywhere, and within seconds I can see it saved with a title, summary, content type, and queue assignment — without me doing any manual tagging.

#### Requirements

**FR-L-01 — URL input**
The web UI must have a persistent URL input bar accessible from every page. User pastes a URL and presses Enter or clicks Save. No other fields required.

**FR-L-02 — Metadata fetch**
On submission, the system must fetch the page and extract:
- Page title (from `<title>` or `<og:title>`)
- Description (from `<meta name="description">` or `<og:description>`)
- Favicon URL
- Published date if present (from `<article:published_time>` or similar)

This must happen even if the AI service is unavailable. Metadata extraction is non-AI and must always work.

**FR-L-03 — Deduplication**
If the same URL (after canonicalisation) already exists for this user, the system must not create a duplicate. Instead, show the user a message: *"You already saved this on [date]. View it here."*

Canonicalisation rules:
- Follow all redirects to the final URL
- Strip tracking parameters: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `fbclid`, `gclid`, `ref`
- Normalise trailing slashes

**FR-L-04 — Unreachable URLs**
If the URL returns an error (DNS failure, HTTP 4xx/5xx, timeout after 10 seconds), the link must still be saved with status `unreachable`. The user sees a warning badge. The system must retry the fetch once after 5 minutes automatically.

**FR-L-05 — Queue assignment**
Every saved link must be placed in exactly one queue. Queue is determined by AI classification (see 1.2). If AI is unavailable, the link goes to a default `Inbox` queue until AI processes it later.

The four queues:
- `Watch Later` — videos, recorded talks
- `Read Later` — articles, blog posts, newsletters, papers
- `Try Later` — tools, GitHub repos, products, apps
- `Inbox` — unclassified (AI pending or failed)

**FR-L-06 — Link list view**
The main UI must show all saved links in a list. Each item displays:
- Favicon + title
- Domain name
- Queue badge (Watch Later / Read Later / Try Later / Inbox)
- Content type badge (video / article / tool / etc.)
- AI summary (or a "Processing…" placeholder if AI is pending)
- Date saved
- Status indicator (processed / processing / unreachable / ai-failed)

**FR-L-07 — Mark as done**
User must be able to mark any link as done (read/watched/tried). Done items move to an Archive view, not deleted. A single click/button is enough — no confirmation dialog needed.

**FR-L-08 — Delete link**
User must be able to permanently delete a link. Deletion requires a single confirmation ("Delete this link?").

**FR-L-09 — Basic filter**
User must be able to filter the link list by queue (All / Watch Later / Read Later / Try Later / Inbox / Archive). A tab bar or sidebar is sufficient. No other filters needed in MVP.

---

### 1.2 AI Processing — with graceful degradation

AI makes Arciv smart, but it must never be a single point of failure. The system works with or without AI. AI enrichment happens asynchronously, so the user never waits for it.

#### User story
> As a user, I want my links classified and summarised automatically. But if the AI service is down or my API key runs out, I still want my links saved and accessible — and I want the AI to catch up automatically when the service recovers.

#### AI providers supported

| Provider | Tier | Cost | Notes |
|---|---|---|---|
| **Google Gemini** (`gemini-1.5-flash`) | Free | Free up to quota | Default for new users, no card needed |
| **Groq** (`llama-3.1-8b-instant`) | Free | Free tier available | Fast inference, good for classification |
| **Anthropic Claude** (`claude-haiku-4-5`) | Paid | ~$0.80 / 1M input tokens | Best quality, opt-in |
| **OpenAI** (`gpt-4o-mini`) | Paid | ~$0.15 / 1M input tokens | Popular option, opt-in |
| **Ollama** (local) | Free | Local compute only | Self-hosters who want full privacy |

The user selects their preferred provider and enters their API key in Settings. The free providers (Gemini, Groq) work out of the box with no key needed beyond what Arciv provides as a shared default — with usage limits per user per day to prevent abuse.

#### What AI does per link

**Step 1 — Content type detection**
Classify the link into one of: `video`, `article`, `research-paper`, `tool`, `newsletter`, `documentation`, `other`

**Step 2 — Intent routing**
Map content type to a queue: `watch-later`, `read-later`, `try-later`

**Step 3 — Summary**
Generate a 2–3 sentence plain-language summary of what this link is about.

**Step 4 — Tags**
Extract 3–5 topic tags (e.g. `python`, `system-design`, `machine-learning`)

These four steps run as a single LLM call with structured output (JSON). Not four separate calls.

#### Graceful degradation — what happens when AI is down

This is the critical design requirement. The system must handle AI failure at every level without losing user data or breaking the UI.

**Scenario A — API key missing or not configured**
- Link is saved immediately with status `ai-pending`
- UI shows "AI not configured — add an API key in Settings to enable smart classification"
- Link goes to `Inbox` queue
- When user adds an API key later, all `ai-pending` links are reprocessed automatically

**Scenario B — AI API returns an error (rate limit, 5xx, timeout)**
- Job is retried with exponential backoff: 2 min → 10 min → 1 hour → 6 hours
- After 4 failed attempts, status is set to `ai-failed`
- Link is still fully accessible in `Inbox` queue — it's just unclassified
- User can manually trigger a retry from the link card
- Once the service recovers, a background sweep job reprocesses all `ai-failed` links once per hour

**Scenario C — AI returns malformed or unparseable output**
- System logs the raw response
- Fallback: use page metadata only (title + description) to make a best-guess classification based on URL patterns:
  - `youtube.com`, `vimeo.com`, `youtu.be` → `video` → Watch Later
  - `github.com` → `tool` → Try Later
  - All else → `article` → Read Later
- This heuristic classification is marked as `ai-skipped` (not `ai-failed`) so the user knows it was auto-classified without AI

**Scenario D — Provider quota exhausted for the day**
- System detects quota error (HTTP 429 with specific quota message)
- Stops retrying until midnight UTC (when most free quotas reset)
- Displays a soft warning in the UI: *"AI processing paused — free quota reached. Resumes tomorrow, or switch to a paid provider."*
- Links continue to be saved normally in `Inbox`

**Scenario E — Ollama / local model is unreachable**
- Treated same as Scenario B — retry with backoff
- After 4 failures, a specific message: *"Local AI model unreachable — is Ollama running?"*

#### AI processing requirements

**FR-A-01** — AI processing must be asynchronous. The link save API must return a response within 500ms, before any AI processing begins.

**FR-A-02** — AI processing must run in a background job queue (not in the API request thread).

**FR-A-03** — The system must store the raw AI response alongside the parsed result for debugging purposes.

**FR-A-04** — All AI-generated fields (summary, tags, content_type, queue) must be clearly marked as AI-generated in the UI with a small indicator, so users know they are suggestions, not facts.

**FR-A-05** — Users must be able to manually override: the queue assignment, content type, and tags on any link — regardless of what AI said.

**FR-A-06** — The system must expose a settings page where users can: select their AI provider, enter their API key, test the connection with a single button click, and see today's estimated usage.

**FR-A-07** — API keys must never be stored in plaintext. They must be encrypted at rest using AES-256 with a server-side encryption key stored in environment variables.

**FR-A-08** — The job queue must be persistent. If the server restarts, pending AI jobs must survive and be picked up when the server comes back online.

---

### 1.3 Daily Blog / Feed Tracker

The system watches blog and newsletter sources the user subscribes to, checks them daily for new posts, and notifies the user.

#### User story
> As a user, I subscribe to 10 tech blogs and 3 Substacks. Every morning, Arciv checks them all, automatically adds any new posts to my Read Later queue, and sends me a summary of what's new — via Telegram or in-app notification. I don't have to manually check any of these sites.

#### How sources are added

**FR-F-01 — Add a source by URL**
User pastes any URL into the Feed Tracker page — this can be:
- A direct RSS/Atom feed URL (`https://blog.example.com/feed`)
- A blog homepage (`https://blog.example.com`) — system auto-discovers the feed
- A Substack URL (`https://name.substack.com`) — system appends `/feed`

The system responds within 5 seconds with: the discovered feed name, number of existing posts, and a "Subscribe" button.

**FR-F-02 — Feed auto-discovery**
When given a homepage URL:
1. Fetch the page HTML
2. Look for `<link rel="alternate" type="application/rss+xml" href="...">` in `<head>`
3. If found, use that URL
4. If not found, try these common paths in order: `/feed`, `/rss`, `/rss.xml`, `/atom.xml`, `/feed.xml`
5. If none work, show the user: *"No feed found at this URL. Try pasting the direct RSS feed URL."*

**FR-F-03 — What counts as a valid feed**
The system accepts RSS 2.0 and Atom feeds. It must handle:
- Feeds with and without `<guid>` elements (fall back to `<link>` for dedup)
- Feeds that return `Content-Type: text/xml` or `application/xml` or `application/rss+xml` or `application/atom+xml`
- Feeds with up to 1000 items (older items beyond 1000 are ignored on first import)

On first subscribe, the system imports the 10 most recent items from the feed into the user's Read Later queue. Not all items — just the 10 most recent, to avoid flooding the queue.

**FR-F-04 — Daily polling**
A background cron job runs once per day at a configurable time (default: 08:00 local server time).

For each active feed:
1. Send HTTP GET with `If-None-Match` (ETag) and `If-Modified-Since` headers if available from the previous fetch
2. If server returns `304 Not Modified` → skip, update `last_checked_at`
3. If server returns `200` → parse the feed, find new items (by GUID or link, not seen before)
4. For each new item: create a link record and push it to the AI job queue
5. Update feed: `last_checked_at`, `last_etag`, `last_modified`, reset `consecutive_failures` to 0

Daily is intentional for MVP. Hourly polling is more complex to scale and most blogs don't publish more than once a day.

**FR-F-05 — New content notification**

When new posts are found in the daily poll, the user must be notified. Two notification methods for MVP:

**In-app notification** (always enabled):
- A notification bell icon in the top bar shows a badge count of unread notifications
- Clicking it opens a notification panel listing: "[Blog Name] published 2 new posts today" with titles and links
- Notifications are marked as read when the panel is opened

**Telegram notification** (optional, user-configured):
- If the user has linked their Telegram account, the bot sends a daily message:

```
📬 Arciv Daily — 3 new posts added

• Paul Graham's Blog: "What to Do With Your Ideas"
• Lenny's Newsletter: "The Art of the Roadmap"
• ByteByteGo: "How Search Engines Work"

View all in Arciv →
```

- This message is sent once per day, only if there are new items
- If no new items were found, no message is sent

**FR-F-06 — Feed failure handling**
If a feed fails to fetch (DNS error, timeout, HTTP 5xx):
- Increment `consecutive_failures` counter
- Retry the next day (not immediately — once-daily is already the schedule)
- After 7 consecutive failures: mark feed as `degraded`, show a warning badge on the feed in the UI, but do NOT delete it
- After 30 consecutive failures (about 1 month): mark feed as `dead`, notify the user once: *"[Blog Name] hasn't been reachable for 30 days. Remove it?"*

The system must never automatically delete a feed without user action.

**FR-F-07 — Feed management UI**
A dedicated Feed Tracker page must show:
- List of all subscribed sources with: name, favicon, URL, status badge (`active` / `degraded` / `dead`), last checked date, total posts received
- "Add source" input at the top
- Pause / Resume toggle per feed (paused feeds are skipped in the daily poll)
- Delete button per feed (with confirmation: *"Remove this source? Your saved items from it will not be deleted."*)

**FR-F-08 — Telegram bot for MVP**
The Telegram bot in MVP has two jobs only:
1. Link submission: user forwards a URL to the bot → saved to Arciv (same as manual web submission)
2. Daily digest: bot sends the daily new content notification

Linking Telegram to a Arciv account is done via a one-time token from the Settings page. User sends `/start <token>` to the bot to complete linking.

---

## 2. Non-Functional Requirements

### Performance

**NFR-P-01** — Link save API must respond within 500ms (AI happens async, not in this window).

**NFR-P-02** — Page load for the link list must be under 2 seconds for up to 500 saved links.

**NFR-P-03** — Feed metadata fetch on subscription must complete within 5 seconds or timeout with a user-facing error.

**NFR-P-04** — The daily feed poll job must complete all feeds within 1 hour (supports up to ~500 feeds at 5 sec/feed with 5 concurrent workers).

### Reliability

**NFR-R-01** — A submitted link must never be lost. If the server crashes mid-save, the link must be recoverable from the database on restart.

**NFR-R-02** — The AI job queue must be persistent (backed by the database, not in-memory). Server restarts must not lose pending jobs.

**NFR-R-03** — Feed polling failures must be isolated — one feed timing out must not delay or cancel other feeds in the same poll run.

**NFR-R-04** — The system must have a `/health` endpoint returning: API status, database connectivity, job queue status, and last feed poll timestamp.

### Security

**NFR-S-01** — All pages and API endpoints require authentication. Unauthenticated requests redirect to login.

**NFR-S-02** — All database queries must be scoped to the authenticated user's ID. No cross-user data access is possible.

**NFR-S-03** — AI API keys are encrypted at rest (AES-256). They are never returned in API responses — only a masked version (`sk-...****`) is shown in the UI.

**NFR-S-04** — Rate limiting on the link submission endpoint: max 30 links per user per hour.

**NFR-S-05** — Telegram webhook must validate the `X-Telegram-Bot-Api-Secret-Token` header on every request.

### Self-hosting

**NFR-H-01** — Full system must start with `docker compose up`. No manual steps after setting `.env` variables.

**NFR-H-02** — All config (DB credentials, AI keys, Telegram token, cron time) is via `.env` file only.

**NFR-H-03** — An `.env.example` file must document every variable.

---

## 3. Technical Stack

Chosen for simplicity, beginner-friendliness, and good learning value.

| Layer | Technology | Why |
|---|---|---|
| Backend | **Python + FastAPI** | Async-first, simple, great AI SDK support |
| Job queue | **ARQ** (Redis-backed) | Simpler than BullMQ for Python, persistent, supports retries |
| Database | **PostgreSQL** | Reliable, easy to reason about, good Python support |
| Cache / Queue backend | **Redis** | Powers ARQ job queue, fast key-value ops |
| Feed parsing | **feedparser** (Python library) | Handles RSS 1.0, RSS 2.0, Atom out of the box |
| Page scraping | **httpx + BeautifulSoup4** | Fetch pages, extract metadata, discover feed URLs |
| Frontend | **React + Vite + TailwindCSS** | SPA, fast builds, widely understood |
| Auth | **JWT** (via python-jose) + bcrypt | Stateless, works well for self-hosted |
| Telegram bot | **python-telegram-bot** | Well-maintained, async |
| Containerisation | **Docker + Docker Compose** | Single-command deployment |
| DB migrations | **Alembic** | Version-controlled schema changes |

**AI SDK — one unified interface:**
```python
# Single provider interface used across all AI calls
class AIProvider:
    async def classify_and_summarise(self, title: str, content: str, url: str) -> AIResult | None:
        ...

# Implementations:
GeminiProvider(AIProvider)    # free default
GroqProvider(AIProvider)      # free alternative
AnthropicProvider(AIProvider) # paid, best quality
OpenAIProvider(AIProvider)    # paid
OllamaProvider(AIProvider)    # local
```

All providers implement the same interface. Swapping providers requires only a settings change — no code changes.

---

## 4. Database Schema

Minimal schema for MVP. No premature optimisation.

### `users`

```sql
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    telegram_chat_id BIGINT,                        -- null until linked
    ai_provider     VARCHAR(50) DEFAULT 'gemini',   -- gemini | groq | anthropic | openai | ollama
    ai_api_key_enc  TEXT,                           -- AES-256 encrypted, null = use shared default
    feed_notify_telegram BOOLEAN DEFAULT true,
    feed_notify_inapp    BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT now()
);
```

### `links`

```sql
CREATE TABLE links (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feed_id         UUID REFERENCES feeds(id) ON DELETE SET NULL, -- null = manually added
    url             TEXT NOT NULL,
    canonical_url   TEXT NOT NULL,
    title           TEXT,
    description     TEXT,                           -- from page meta
    favicon_url     TEXT,
    -- AI fields (all nullable — filled async)
    content_type    VARCHAR(50),                    -- video | article | tool | research-paper | newsletter | documentation | other
    queue           VARCHAR(30) DEFAULT 'inbox',    -- watch-later | read-later | try-later | inbox
    ai_summary      TEXT,
    ai_tags         TEXT[],
    ai_status       VARCHAR(30) DEFAULT 'pending',  -- pending | processing | done | failed | skipped
    ai_provider_used VARCHAR(50),                   -- which provider actually ran
    ai_error        TEXT,                           -- last error message, for debugging
    ai_raw_response JSONB,                          -- raw LLM response, for debugging
    ai_attempt_count INT DEFAULT 0,
    ai_next_retry_at TIMESTAMPTZ,
    -- User state
    status          VARCHAR(20) DEFAULT 'active',   -- active | done | deleted
    fetch_status    VARCHAR(20) DEFAULT 'ok',       -- ok | unreachable
    done_at         TIMESTAMPTZ,
    -- Timestamps
    saved_at        TIMESTAMPTZ DEFAULT now(),
    processed_at    TIMESTAMPTZ,
    UNIQUE (user_id, canonical_url)                 -- deduplication
);

CREATE INDEX idx_links_user_queue ON links(user_id, queue);
CREATE INDEX idx_links_ai_retry   ON links(ai_status, ai_next_retry_at)
    WHERE ai_status IN ('pending', 'failed');
```

### `feeds`

```sql
CREATE TABLE feeds (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    site_url            TEXT NOT NULL,              -- what user pasted
    feed_url            TEXT NOT NULL,              -- resolved RSS/Atom URL
    title               VARCHAR(255),
    favicon_url         TEXT,
    status              VARCHAR(20) DEFAULT 'active', -- active | paused | degraded | dead
    last_checked_at     TIMESTAMPTZ,
    last_etag           TEXT,
    last_modified       TEXT,
    consecutive_failures INT DEFAULT 0,
    total_items_received INT DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT now(),
    UNIQUE (user_id, feed_url)
);
```

### `feed_items`

```sql
-- Tracks which GUIDs we've already seen, to prevent duplicate imports
CREATE TABLE feed_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feed_id     UUID NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    guid        TEXT NOT NULL,                      -- RSS <guid> or <link> if no guid
    link_id     UUID REFERENCES links(id),           -- the link we created for this item
    seen_at     TIMESTAMPTZ DEFAULT now(),
    UNIQUE (feed_id, guid)
);

CREATE INDEX idx_feed_items_feed ON feed_items(feed_id);
```

### `notifications`

```sql
CREATE TABLE notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        VARCHAR(50) NOT NULL,               -- new_feed_items | ai_quota_warning | feed_degraded | feed_dead
    title       TEXT NOT NULL,
    body        TEXT,
    is_read     BOOLEAN DEFAULT false,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_notifications_user_unread ON notifications(user_id, is_read)
    WHERE is_read = false;
```

### `jobs` (audit log for AI processing)

```sql
CREATE TABLE jobs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    link_id     UUID NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    attempt     INT NOT NULL DEFAULT 1,
    status      VARCHAR(20) NOT NULL,               -- queued | running | done | failed
    error       TEXT,
    started_at  TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT now()
);
```

---

## 5. AI Provider Strategy

### Free providers for new users (no API key needed)

Arciv ships with a shared Gemini free-tier key that new users get by default. This lets someone try Arciv without needing to sign up for any AI service first.

Shared key abuse prevention:
- Max 20 AI calls per user per day on the shared key
- Rate limit tracked in Redis (`ai_usage:{user_id}:{date}`)
- When the daily limit is hit, links go to `Inbox` with a soft message:
  *"Daily AI limit reached on the free plan. Add your own Gemini API key (free) in Settings to remove this limit."*

### Provider selection logic

```
Request comes in to process a link
    ↓
Does user have a configured provider + API key?
    YES → use their provider
    NO  → use shared Gemini key
        ↓
    Have they hit today's shared limit (20 calls)?
        YES → mark link ai_status='pending', skip for now
        NO  → proceed
    ↓
Call AI provider
    ↓
Success? → parse JSON, update link fields
    ↓
Failure?
    Rate limit (429)     → schedule retry at midnight
    Server error (5xx)   → exponential backoff retry
    Timeout              → exponential backoff retry
    Parse error          → apply URL heuristic fallback, mark ai_status='skipped'
    Auth error (401/403) → mark ai_status='failed', notify user: "API key invalid"
```

### Retry schedule (exponential backoff)

| Attempt | Delay before retry |
|---|---|
| 1 (first try) | immediate |
| 2 | 2 minutes |
| 3 | 10 minutes |
| 4 | 1 hour |
| After 4 failures | status = `ai-failed`, stop retrying. User or sweep job can trigger manual retry. |

### URL heuristic fallback (no AI needed)

Used when AI is unavailable and user has no custom provider. Zero LLM calls. Based on URL patterns only.

```python
HEURISTIC_RULES = [
    (["youtube.com", "youtu.be", "vimeo.com", "loom.com"], "video",   "watch-later"),
    (["github.com", "gitlab.com", "npmjs.com", "pypi.org"], "tool",   "try-later"),
    (["arxiv.org", "scholar.google"],                        "research-paper", "read-later"),
    (["substack.com"],                                       "newsletter", "read-later"),
]
# Default for anything not matched:
DEFAULT = ("article", "read-later")
```

---

## 6. API Endpoints

Minimal surface area for MVP.

### Auth
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Create account (email + password) |
| `POST` | `/api/auth/login` | Returns JWT access token |
| `POST` | `/api/auth/telegram/link` | Returns one-time token for Telegram linking |

### Links
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/links` | Submit a URL. Returns immediately with saved link (AI async). |
| `GET` | `/api/links` | List links. Query params: `queue`, `status`, `page`, `limit` |
| `PATCH` | `/api/links/:id` | Update: queue, content_type, tags, status (done/active) |
| `DELETE` | `/api/links/:id` | Delete a link permanently |
| `POST` | `/api/links/:id/retry-ai` | Manually trigger AI reprocessing for one link |

### Feeds
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/feeds/discover` | Given a URL, return the discovered feed info (name, feed URL, item count). Does not subscribe yet. |
| `POST` | `/api/feeds` | Subscribe to a discovered feed |
| `GET` | `/api/feeds` | List all subscribed feeds |
| `PATCH` | `/api/feeds/:id` | Update status (pause/resume) |
| `DELETE` | `/api/feeds/:id` | Unsubscribe from a feed |
| `POST` | `/api/feeds/:id/check-now` | Manually trigger a poll for one feed |

### Notifications
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/notifications` | List unread notifications |
| `POST` | `/api/notifications/read-all` | Mark all as read |

### Settings
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/settings` | Get user settings (AI provider, masked key, notification prefs) |
| `PATCH` | `/api/settings` | Update settings |
| `POST` | `/api/settings/ai/test` | Test AI connection with current settings. Returns success/error. |

### System
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | System health: DB, Redis, last feed poll time |

---

## 7. What is NOT in MVP

Explicitly excluded. Do not build these in v1.

| Feature | Why excluded |
|---|---|
| Semantic / vector search | Requires pgvector, embedding model, more complexity. Basic text search is enough for MVP. |
| Topic explorer / clustering | Nice to have, not core to the problem |
| Proactive agent / nudges | Requires usage history and more AI calls |
| Weekly knowledge digest | Low priority without established usage patterns |
| Browser extension | Telegram bot + web paste covers mobile + desktop for now |
| Social / sharing features | Not a social product in v1 |
| Multi-user / teams | Single user per instance is fine for MVP |
| Non-feed URL change detection | Ambitious feature, save for v2 |
| Full-text search | Basic filter by queue is sufficient for MVP |
| Reading mode / distraction-free view | Out of scope |
| Highlights / annotations | Out of scope |
| Data export | Useful, but not blocking |
| Mobile app | Telegram bot covers mobile use case |
| OAuth / Google login | Email + password is enough for MVP |

---

## 8. Build Order

Ship in this order. Each step produces something usable.

```
Week 1 — Foundation
  ├── Docker Compose: PostgreSQL + Redis + FastAPI skeleton
  ├── Alembic migrations: users + links tables
  ├── Auth: register, login, JWT middleware
  └── Health endpoint

Week 2 — Link saving (core loop)
  ├── POST /api/links: save URL, fetch metadata, canonicalise, dedup
  ├── GET /api/links: list with queue filter
  ├── PATCH /api/links/:id: mark done, manual queue override
  └── Basic React UI: URL input bar + link list

Week 3 — AI pipeline
  ├── ARQ job queue connected to Redis
  ├── GeminiProvider + shared key + per-user limit
  ├── AI classify + summarise in single LLM call
  ├── Retry logic + exponential backoff
  ├── URL heuristic fallback
  └── Settings page: select provider, enter key, test connection

Week 4 — Feed tracker
  ├── feeds + feed_items + notifications tables
  ├── Feed discovery endpoint (auto-detect RSS from URL)
  ├── POST /api/feeds: subscribe + import 10 recent items
  ├── Daily cron job: poll all active feeds
  ├── Feed failure handling + consecutive_failures counter
  └── Feed Manager UI: add/pause/remove sources

Week 5 — Notifications + Telegram
  ├── In-app notification bell + panel
  ├── Telegram bot: /start <token> linking flow
  ├── Telegram bot: receive URL → submit to API
  ├── Daily digest message via Telegram
  └── Settings: notification preferences

Week 6 — Polish + ship
  ├── .env.example with all variables documented
  ├── README with quickstart, screenshots
  ├── Error states in UI (unreachable links, AI failed, feed degraded)
  ├── Basic responsive design
  └── Tag v0.1.0, push Docker images to ghcr.io
```

**Definition of done for MVP:**
A user can self-host with `docker compose up`, paste a link from the web, have it classified by AI (or gracefully queued if AI is down), subscribe to a blog feed, and receive a Telegram notification the next morning when that blog publishes something new.