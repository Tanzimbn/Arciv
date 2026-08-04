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
pip install -r requirements.txt -r requirements-dev.txt
pytest                       # integration tests skip with a reason
```

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

## Known gap

`api/utils/metadata._assert_safe_url` blocks private **IP literals** but never
resolves hostnames, so `http://internal-host/` reaches the fetcher. This is
documented as an accepted limitation in
`tests/test_ssrf_guard.py::test_known_gap_hostnames_are_not_resolved` rather than
left silent. Closing it means resolving the host, validating every returned
address, and pinning the connection to a validated one to defeat DNS rebinding —
if that lands, invert that test.
