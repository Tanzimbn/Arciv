# Tests

Two layers, split by whether they need running services.

| Layer | Location | Needs | Runtime |
|---|---|---|---|
| unit | `tests/test_*.py` | nothing | ~1s |
| integration | `tests/integration/` | Postgres (pgvector) + Redis | ~30s |

The integration layer runs the real FastAPI app in-process over
`httpx.ASGITransport`, against a real database and real Redis. The invariants it
covers — per-`user_id` scoping, quotas, storage accounting, rate-limit counters,
pgvector ordering — are enforced by SQL and Redis, so mocking them out would test
nothing.

## Running

Unit layer only, no setup:

```bash
python3.12 -m venv venv && source venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
pytest                       # integration tests skip with a reason
```

Python 3.12, matching the Dockerfile and CI — `asyncpg` and `pydantic-core` have
no 3.13 wheels at the pinned versions and fall back to a source build.

Full suite. Ports are deliberately non-default so a throwaway stack can't collide
with your dev `docker compose` stack:

```bash
docker run -d --name arciv-test-pg \
  -e POSTGRES_USER=arciv -e POSTGRES_PASSWORD=arciv -e POSTGRES_DB=arciv_test \
  -p 55432:5432 pgvector/pgvector:pg16
docker run -d --name arciv-test-redis -p 56379:6379 redis:7

TEST_DATABASE_URL=postgresql://arciv:arciv@localhost:55432/arciv_test \
TEST_REDIS_URL=redis://localhost:56379/15 \
pytest
```

Teardown: `docker rm -f arciv-test-pg arciv-test-redis`.

Selecting a layer explicitly:

```bash
pytest -m "not integration"
pytest -m integration
pytest tests/integration/test_tenancy.py -k dedup
```

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `TEST_DATABASE_URL` | `postgresql://arciv:arciv@localhost:5432/arciv_test` | Test database. The name **must** end in `_test` — `conftest.py` refuses to start otherwise, because the suite `TRUNCATE`s every table between tests. |
| `TEST_REDIS_URL` | `redis://localhost:6379/15` | Test Redis. Cleanup deletes only this app's key prefixes, never `FLUSHDB`. |
| `ARCIV_REQUIRE_SERVICES` | unset | `1` turns "services unreachable → skip" into a hard failure. CI sets it so a broken service container can't silently shrink the suite. |

Note the defaults are the *standard Compose ports*. If your dev stack is running,
a bare `pytest` will find it and run the integration layer against it — creating a
separate `arciv_test` database beside your `arciv` one and using Redis db 15. Your
dev data is never touched (the `_test` guard and the prefix-scoped Redis cleanup
both hold), but if you'd rather keep the two stacks fully apart, point
`TEST_DATABASE_URL`/`TEST_REDIS_URL` at the throwaway containers above.

`conftest.py` forces every setting the suite asserts on (`DATABASE_URL`,
`ENCRYPTION_KEY`, all quota and rate-limit knobs, …) into `os.environ` *before*
`api.config` is imported. pydantic-settings gives the process environment
precedence over `.env`, so your local `.env` can never change a test outcome.

Quotas and rate limits default to `0` (off/unlimited); each test opts in via
`monkeypatch.setattr(settings, …)`, so a limit is only ever asserted against a
value that test set itself.

## Fixtures worth knowing

- `client` — `AsyncClient` bound to the app via `ASGITransport`.
- `app_state` — installs a `FakeArqPool` on `app.state`. Enqueued jobs are
  recorded rather than run (`pool.jobs`, `pool.job_args("send_email_job")`), and
  `incr`/`expire`/`get`/`set` proxy through to the live Redis so rate-limit
  counters are real.
- `make_user(email=None, password=TEST_PASSWORD, **fields)` — inserts a verified
  user directly and returns `(user_id, auth_headers)`, skipping three bcrypt
  hashes per test. The register→verify→login round-trip has its own coverage in
  `tests/integration/test_auth_flow.py`.
- `no_network` — patches `httpx.AsyncHTTPTransport.handle_async_request` so any
  real outbound request fails the test. `ASGITransport` is a different class, so
  in-process requests still work. `app_state` depends on it.
- `session_factory` — direct DB access for asserting on rows the API doesn't
  expose (encrypted key columns, `storage_bytes`, cascade behaviour).
- `fake_vector(text)` — deterministic hashed bag-of-words embedding. Shared
  vocabulary lands close, so cosine-ordering assertions mean something without
  loading a real model. The pgvector distance and ordering on top are real.

## Event loop

`pytest.ini` sets `asyncio_default_*_loop_scope = session`. The app's SQLAlchemy
engine is created at import time and its asyncpg connections bind to the loop that
opened them — a fresh loop per test would hand out connections attached to a dead
one. Don't lower this to `function` scope without also rebuilding the engine per
test.

## Outbound fetching

`tests/test_ssrf_guard.py` owns the policy in `api/utils/safe_fetch.py`: blocked
address classes, hostname resolution, per-hop redirect revalidation, and that the
connection is pinned to the validated address while `Host` and `sni_hostname` keep
the real hostname. Two things there are easy to break by accident:

- **Never let a test do real DNS.** Patch `safe_fetch._resolve`; the `no_network`
  fixture only catches real HTTP, not `getaddrinfo`.
- **`safe_request` returns `(response, logical_url)`.** The logical URL is
  hostname-based; `response.url` is the pinned IP. Anything feeding
  canonicalisation must use the former or DB-level dedup breaks silently —
  `test_final_url_is_logical_not_the_pinned_address` pins that.

`test_no_module_fetches_a_user_url_outside_safe_fetch` scans the fetcher modules'
source, so a new `httpx.get(user_url)` fails CI instead of shipping unguarded. Add
the module to its watch list when you add a fetcher.

`tests/integration/test_outbound_guard.py` covers the paths that swallow every
exception and write to the DB instead of returning anything — feed poll, link
create, subscribe seeding — where row state is the only observable proof the guard
fired.

## AI failure modes

Three files, one invariant between them: a request that **cannot** succeed must
not be retried, and the user must be told.

- `tests/test_provider_errors.py` (unit) — `agent/errors.raise_mapped` maps by
  **status code**, never by message substring. The stand-in exception classes are
  deliberate: the three OpenAI-codegen SDKs need a live `httpx.Request` to build
  an `APIStatusError`, and the attribute shape (`status_code` / `.code` /
  `.response.status_code`) is the whole contract. The same file pins
  `human_message` against the real error strings each provider emits — Groq's
  python-dict repr, OpenAI's JSON, Gemini's bare `400 …` text, Ollama's
  `{"error": "…"}` — plus the two invariants that matter more than any single
  shape: unparseable text is returned verbatim, and an empty message still says
  something.
- `tests/integration/test_ai_failure_modes.py` — a permanent error ends the link
  on attempt 1 with no job re-enqueued, `sweep_failed_links` leaves
  `ai_error_kind="config"` alone while still requeueing transient failures, and a
  broken config notifies once per user per day. That sweep case is the regression
  guard for the original bug: the ladder outran the hourly sweep, so the link read
  `pending` — "Classifying…" — forever.
- `tests/integration/test_ai_models_endpoint.py` — `POST /settings/ai/models`.
  The provider is patched (`no_network` would fail a real call), but the Redis
  cache and rate-limit counters are the live ones. Cache tests set
  `AI_MODELS_CACHE_TTL = 0` to force every request past the cache — that value
  must disable the cache, not reach Redis, which rejects `SET … EX 0`. The
  `patch_models` fake records `(provider, api_key, model)`, because *which*
  credential answered is the contract: a key typed into the body must be used
  instead of the stored one and must not be persisted, and a refused key must be
  a 400, not a 502.
