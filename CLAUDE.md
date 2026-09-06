# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Arciv** is a self-hostable intelligent link and feed manager. Users save URLs manually or via RSS feeds; an AI pipeline classifies, summarises, and routes them into smart queues. All five MVP phases are scaffolded end-to-end (foundation, link saving, AI pipeline, feed tracker, notifications). Code lives at project root; docs in `docs/`.

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
| DB migrations | Alembic |
| Containerisation | Docker + Docker Compose |

## Project Structure

```
arciv/  (project root — /Users/tanzimbn/Documents/projects/Arciv/)
├── api/                        # FastAPI application
│   ├── routers/                # auth, links, feeds, notifications, settings
│   ├── models/                 # user, link, feed, notification, job
│   ├── schemas/                # auth, link, feed, notification, settings
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
│   └── feed_poll.py            # poll_all_feeds + poll_single_feed
├── db/
│   └── migrations/
│       ├── env.py              # Async Alembic env
│       └── versions/           # 0001 users+links, 0002 jobs,
│                               # 0003 feeds+notifications, 0004 telegram fields,
│                               # 0005 timestamptz, 0006 feed_category,
│                               # … 0015 ollama_cloud, 0016 drop_telegram
├── frontend/                   # React + Vite + Tailwind SPA
│   └── src/
│       ├── views/              # LoginView, LinksView, FeedsView, SettingsView
│       ├── components/         # QueueTabs, UrlInputBar, LinkCard, NotificationBell,
│       │                       # SubpageNav
│       └── api/client.js
├── alembic.ini
├── docker-compose.yml          # db, redis, api, worker, embed, mailhog
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
    DEFAULT_MODEL: str                      # used when users.ai_model is NULL

    def __init__(self, api_key: str, model: str | None = None): ...

    async def classify_and_summarise(self, title: str, content: str, url: str) -> AIResult | None:
        ...

    async def list_models(self) -> list[str]:   # the provider's own catalogue
        ...
```

**Model is a per-user setting, never a constant.** `users.ai_model` (`String(100)`,
nullable; NULL = that provider's `DEFAULT_MODEL`) is threaded through
`make_provider(provider, api_key, model=None)` by all three call sites —
`worker/ai_classify._get_provider`, `POST /links/:id/insights`,
`POST /settings/ai/test`. `POST /api/settings/ai/models` lists what a key can
actually reach by calling the provider's own list endpoint, cached in Redis at
`ai_models:<provider>:<sha256(key)[:16]>` for `AI_MODELS_CACHE_TTL` (`0` = no
cache; Redis rejects `SET … EX 0`, so the write must be skipped, not passed
through) and rate limited by `AI_MODELS_PER_MINUTE`. It is a POST because the
body may carry `{provider, api_key}` for a key the user has typed but not saved —
for four of the five providers listing models is the cheapest credential check
there is, so it doubles as "is this key valid?" and nothing has to be persisted
first; a secret must never travel in a URL. **Ollama Cloud is the exception** —
its catalogue is public, so `GET /api/tags` answers 200 with the full list for a
bogus key *and* for no key at all, which is why `OllamaProvider.list_models`
probes `GET /api/ps` first (see below). Any provider added later must be checked
the same way rather than assumed. A refused key is a **400** (`AuthError`), a provider outage a
**502**, so the UI can name the field to fix instead of blaming upstream.
Neither is cached. Never hardcode a model as
the only way to reach a provider — a provider retiring one must be fixable in
Settings, not by a redeploy. `update_settings` clears `ai_model` when
`ai_provider` changes without a model in the same PATCH, or a stale id 404s every
classify. Unknown provider names raise `ValueError`; they do not fall back to
Gemini.

**Permanent AI errors are terminal; only transient ones retry.** `agent/errors.py`
classifies by **status code**, not message substrings (`raise_mapped`): `401/403 →
AuthError`, `429 → QuotaError`, `400/404 → ModelError`, anything else re-raised as
transient. On a fixed SDK endpoint the model name is the only user-controlled part
of the request, so 400/404 means the config is wrong. `ModelError` and `AuthError`
set `links.ai_error_kind = "config"` and fail the link on the **first** attempt —
no backoff ladder — and `sweep_failed_links` filters them out with
`Link.ai_error_kind.is_distinct_from("config")` (a plain `!= "config"` is NULL for
every pre-existing row and would silently stop retrying *all* transient failures).
`POST /links/:id/retry-ai` clears the marker. Each failure branch that writes
`ai_error` must account its bytes (`ai_error` is in `storage._TEXT_FIELDS`), and
`_notify_ai_config_broken` raises one in-app notification per user per day, guarded
by `SET ai_config_alert:<user_id> NX EX 86400`.

**Provider error text is cleaned only at user-facing boundaries.**
`agent/errors.human_message` turns an SDK's `Error code: 401 - {'error':
{'message': 'Invalid API Key', 'code': 'expired_api_key'}}` into `Invalid API Key
(expired_api_key)` — the provider's own sentence plus the machine code, which is
the part that says *which* fix applies. It parses the payload (`ast.literal_eval`
→ `json.loads` → regex) and walks it, because providers nest the message
differently (`{"error": {"message": …}}` for Groq/OpenAI, a bare `{"error": "…"}`
for Ollama). Unparseable text falls through **verbatim** — the raw string is then
the only clue the user has, so never replace it with a friendlier invented
message. Use it in exactly three places: the `/settings/ai/models` 400/502
`detail`, `/settings/ai/test`'s `message`, and the `ai_config` notification body.
`links.ai_error` and the worker logs keep the raw string; they are for debugging,
not reading.

**Persistent job queue.** ARQ jobs are Redis-backed. Server restarts must not lose pending jobs. AI retry schedule: immediate → 2 min → 10 min → 1 hour → mark `ai-failed`.

**All data scoped by `user_id`.** Every DB query must include a `user_id` filter. No cross-user access is possible.

**Topics are derived on read; the tag normaliser has an exact SQL twin.**
`api/utils/tags.py` holds `normalise_tag` (Python) and `tag_key_sql` (SQL) —
lowercase, whitespace and `_` to `-`, runs collapsed, edges trimmed. One groups
(`GET /api/topics` unnests `ai_tags` through a LATERAL join and `GROUP BY`s the
key), the other resolves `?tag=` on `GET /api/links` and `/links/search`. They
must stay twins: a divergence means a topic chip that says 7 opens a list of 4.
The same agreement is why narrowing lives in one module: `api/utils/link_query.py`
holds `apply_queue_scope` and `apply_link_filters`, and **both** the topic list
and the link list call them. `GET /api/topics?queue=` is what makes the panel
describe the active tab — on Try Later it lists Try Later's topics with Try
Later's counts, and a topic with no links in that tab drops off rather than
offering a click that returns nothing. `queue="archive"` reads *status*, not
queue, in both places. Duplicating that if/elif into the topics router instead
would reintroduce exactly the drift this design exists to prevent.
Character classes are written longhand (`[ \t\n\r\f\v_]+`, never `\s`) because
Python's `\s` is unicode-aware while Postgres' is locale-dependent, and
`tests/integration/test_topics.py` asserts the pair agrees inside real Postgres
on tags containing a literal tab and newline. Normalisation never happens on
**write** — stored tags keep the model's or the user's chosen casing, since
rewriting them would overwrite a deliberate hand edit in the drawer and need an
irreversible backfill. `agent/prompt.py` asks for already-normalised tags to
reduce divergence at source instead. There is **no GIN index** on `ai_tags`: the
predicate is over a normalised *element*, which an index on raw values cannot
answer; the scan is bounded by `MAX_LINKS_PER_USER` and narrowed by
`idx_links_user_queue`. A tag that normalises to `""` or a malformed `?domain=`
returns an **empty list**, never the unfiltered library — silently dropping a
filter looks like a match; with several tags, one unusable key fails the whole
request under `any` too, since the extra rows would read as real matches.
**`?tag=` is repeatable** (capped at 10 keys — each is its own `EXISTS` over the
row's unnested tags) and `?tag_logic=any|all` picks union or intersection.
Neither logic contains the other — "anything about rust or LLMs" and "the link
about both" are different questions — so `components/TopicsFilter.jsx` exposes
the switch instead of assuming one, and repeated spellings of one key
(`?tag=Rust&tag=rust`) collapse to a single key rather than AND-ing a key with
itself. The client must send arrays as repeated params (`api/client.js:qs`): a
plain `URLSearchParams` stringifies `["a","b"]` to `a,b`, which the server reads
as one topic named `a,b` and matches nothing. `GET /api/links/search` applies filters **before**
`ORDER BY cosine_distance`: ranking first and filtering the page after turns
"top 30 matches, 3 tagged rust" into a 3-result search. The `content_type`,
`domain`, `since` and `until` params have **no UI surface** — the Topics panel
(plus the queue tabs and the search box it shares a card with) is the only
discovery control in `LinksView`. They stay because they are the shared
plumbing `?tag=` and the filter-before-rank search path are built on, and they
are covered by tests; don't delete them as dead code.

**API keys encrypted at rest.** `ai_api_key_enc` in the DB uses AES-256 (`api/utils/encryption.py`). Keys are never returned in API responses — only a masked version (`sk-1...cdef` — first 4 and last 4; the tail is the part that identifies *which* key it is, since every key from a provider shares its prefix, and keys under 16 chars get no tail at all). One key per account, not one per provider: `ai_api_key_enc` is a single column used with whatever `ai_provider` is set to, so the stored key belongs to the saved provider and Settings must not present it under another one. There is exactly one such column and no per-provider special case: all five providers, Ollama included, store an opaque secret there and get the same mask. (Ollama used to be the exception — a base URL plus a second `ai_auth_token_enc` column for the proxy guarding the user's own server — and that whole shape is gone; see the Ollama Cloud principle below.)

**User-supplied URLs are fetched only via `api/utils/safe_fetch.py`.** `safe_request` / `safe_stream` resolve the host, reject it if any address is private/loopback/link-local/reserved/CGNAT, and pin the connection to the validated address (`Host` header + TLS SNI keep the real hostname), revalidating every redirect hop. They return `(response, logical_url)` — use `logical_url`, never `response.url` (which is the pinned IP), or canonicalisation and `UNIQUE (user_id, canonical_url)` dedup break silently. Never add a bare `httpx` call on a user URL; `tests/test_ssrf_guard.py::test_no_module_fetches_a_user_url_outside_safe_fetch` scans for it. Operator-configured clients (mailer, Turnstile, embed service) take no user input and stay outside this. **`agent/providers/ollama.py` stays inside anyway**, and stays on the drift-scan watch list, for a different reason: its URL is now the constant `https://ollama.com`, so this is no longer SSRF, but every one of its four requests (`/api/chat` ×2, `/api/tags`, `/api/ps`) carries the user's bearer key. `_fetch_chain` follows redirects itself, so it also reimplements httpx's cross-origin credential strip: `Authorization`/`Cookie`/`Proxy-Authorization` are dropped when a hop changes `(scheme, host, port)` — without it a `302` off ollama.com would hand a user's API key to a third party. `safe_request` accepts a `json` body for this; a 301/302/303 hop drops the body and switches to GET, per RFC. `ALLOW_PRIVATE_NETWORK_FETCH=true` reopens private targets for LAN self-hosters saving links off their own network — it must stay `false` on anything public.

**Ollama is a hosted BYOK provider, not a self-hosted one.** `agent/providers/ollama.py` talks to Ollama Cloud — the constant `https://ollama.com`, Ollama's native protocol (`/api/chat`, `/api/tags`), a bearer key from `ollama.com/settings/keys`, `DEFAULT_MODEL = "gpt-oss:120b"`. It is shaped exactly like Groq: one key field, no address, no proxy token, no operator kill switch, no Redis concurrency gate. Self-hosted Ollama was dropped because *"the API key is a URL the worker then dials"* is a shape no other provider has, and every guard rail it needed existed only to make one user-owned GPU endpoint safe to reach from a shared worker. Migration `0015_ollama_cloud` nulls `ai_api_key_enc` and `ai_model` for `ai_provider = 'ollama'` — a stored base URL 401s as a bearer token and a locally pulled tag matches nothing in the cloud catalogue, so those users are routed to the BYOK banner to reconnect instead of into a silent outage. `list_models` probes `GET /api/ps` before listing (the catalogue is public; see the model-setting principle above), failing **closed** on 401/403 and **open** on 404/405 — the endpoint is in no documented contract, so the cost of having guessed wrong must be "no pre-check", not "nobody can connect". Errors carry the response *body* (`_status_error`, not `raise_for_status()`) because `human_message` reads the exception message and `{"error": "unauthorized"}` is actionable where a URL is not. `OLLAMA_TIMEOUT`/`OLLAMA_LIST_TIMEOUT` must stay under `WorkerSettings.job_timeout` (120s): an arq timeout kill cancels the coroutine, so no `except` branch runs and the row strands at `ai_status="processing"`. That is why setting `processing` also stamps `ai_next_retry_at = now + job_timeout + 60s` (a watchdog — `links` has no `updated_at`) and `sweep_failed_links` picks up stale `processing` rows as transient. The sweep itself is capped by `SWEEP_BATCH_LIMIT` and a per-user `row_number()` window cap (`SWEEP_PER_USER_LIMIT`) and jitters each enqueue over 5 minutes, because it resets `ai_attempt_count` and is the real amplifier.

**Shared Gemini key has a per-user daily cap.** When a user has not configured their own provider, `worker/ai_classify._get_provider` falls back to `SHARED_GEMINI_KEY` only up to `SHARED_DAILY_LIMIT` (currently 20) calls per user per day, tracked in Redis at `ai_usage:<user_id>:<YYYY-MM-DD>`. Past the cap, the link's `ai_status` stays `pending`.

## MVP Phases (all scaffolded — keep extending these)

Each phase is wired up; ongoing work is hardening, edge cases, and polish.

1. **Foundation** — Docker Compose (PostgreSQL 16 + Redis 7 + api + worker + bot), Alembic migrations, JWT auth, `GET /health` endpoint (probes DB + Redis ping + `arciv:last_feed_poll` Redis key set by worker).
2. **Link saving** — `POST /api/links` (metadata fetch via `api/utils/metadata.py`, URL canonicalisation, dedup at DB level), list/patch/delete, retry-ai. Frontend `LinksView` with `QueueTabs` + `UrlInputBar` + `LinkCard`.
3. **AI pipeline** — ARQ queue (`worker/worker.py`), five providers behind one interface, classify+summarise in a single LLM call, exponential backoff (2 min → 10 min → 1 hour → `failed`), hourly `sweep_failed_links` cron. Settings page (`/api/settings`, `/api/settings/ai/test`).
4. **Feed tracker** — `feeds` + `feed_items` tables, RSS auto-discovery (`api/utils/feed_discovery.py`), daily cron poll driven by `FEED_POLL_CRON`, failure handling with consecutive-failure tracking. Feeds support an optional `category` field (String, nullable) for user-defined grouping — exposed in `FeedCreate`, `FeedUpdate`, `FeedResponse` schemas and `PATCH /api/feeds/:id`. **Feeds are notification-only, not auto-ingest** (deliberate deviation from `requirements-mvp.md:220`): subscribing seeds existing GUIDs into `feed_items` with `link_id=NULL` but creates no `Link` rows; the daily poll likewise records new GUIDs and emits a single grouped notification (title + URL per new post in `Notification.body`) without saving anything. The user manually saves any post they want via the existing `POST /api/links` flow. Do not reintroduce auto-Link creation from feeds.
5. **Notifications** — in-app notification bell with unread counter, fed by the feed poller and the AI-config alert path.

**Telegram was removed from the product entirely.** It never shipped enabled and no account was ever linked, so the code, config, UI and schema are all gone: `bot/`, `api/routers/telegram.py`, `api/schemas/telegram.py`, `worker/daily_digest.py`, the `TELEGRAM_*` settings, the `bot` Compose service, the Settings panel, and the four `users` columns (dropped in `0016_drop_telegram`). Migrations `0001`/`0004`/`0005` still name those columns — that is immutable history, not a live feature. Do not reintroduce it.

## Key API Endpoints (MVP)

```
POST   /api/auth/register
POST   /api/auth/login

POST   /api/links              # Save URL — returns fast, AI is async
GET    /api/links              # ?queue=&status=&tag=(repeatable)&tag_logic=any|all&content_type=&domain=&since=&until=&page=&limit=
PATCH  /api/links/:id          # Update queue, content_type, tags, status
DELETE /api/links/:id
POST   /api/links/:id/retry-ai
GET    /api/topics             # ?queue=&min_count=&limit= — ai_tags grouped by normalised key, scoped to the tab

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
- `SHARED_GEMINI_KEY`
- `FEED_POLL_CRON` (default `0 8 * * *` — parsed in `worker/worker.py`; only minute and hour fields are honored)
- `ENVIRONMENT`

## Self-Hosting Requirement

`docker compose up` must start the full stack — `db`, `redis`, `api`, `worker`, `bot` — with no manual steps after setting `.env`. The `api` service runs `alembic upgrade head` before launching uvicorn.

## Testing

The suite lives in `tests/`; full setup notes in `tests/README.md`. Two layers:

- **unit** (`tests/test_*.py`) — no services. Encryption + key rotation, storage byte accounting, URL canonicalisation, SSRF guard, heuristics, signup guards, password/JWT primitives.
- **integration** (`tests/integration/`, `@pytest.mark.integration`) — the real app over `httpx.ASGITransport` against a real Postgres (pgvector) + Redis. Tenancy isolation, quotas, rate limits, storage deltas, account export/delete, semantic search, topics + link filters.

```bash
python3.12 -m venv venv && source venv/bin/activate   # 3.13 has no wheels for asyncpg/pydantic-core at the pinned versions
pip install -r requirements.txt -r requirements-dev.txt
ruff check .
pytest                                    # integration layer skips if services are down
TEST_DATABASE_URL=… TEST_REDIS_URL=… pytest   # full run
```

`Makefile` wraps these: `make venv`, `make test-unit`, `make test` (which brings
up `docker-compose.test.yml` — throwaway pgvector + Redis on 55432/56379 — first),
`make lint`. Local setup is `./scripts/bootstrap-env.sh` (`make setup`) then
`make up`; `.env.example` defaults point SMTP at the bundled MailHog on :8025,
because login requires a verified email and there is no other way to get the link
without reading the worker log.

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
