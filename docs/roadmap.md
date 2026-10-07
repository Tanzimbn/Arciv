# Roadmap

Where Arciv is going. Shipped work is struck through; everything else is
intent, not commitment — no dates are promised. Released changes are recorded
in [CHANGELOG.md](../CHANGELOG.md); the detailed specs live in
[requirements-mvp.md](requirements-mvp.md) and
[requirements-full.md](requirements-full.md).

## Public hosted service

The direction: run Arciv as a hosted, multi-tenant site so anyone can use it without self-hosting — **bring your own AI provider key** (from the providers the app offers) and go. Self-hosting stays first-class. This is a *deployment/operations layer on top of the existing app*, not a rewrite — the tenancy foundation (`user_id` scoping, AES-256 key encryption, email verification, auth rate limiting, SSRF guard) already existed.

**The hardening layer that gated it has shipped**, all of it off or unlimited by
default so a self-hoster is unaffected:

- ~~Rate limiting on non-auth routes~~ — per-minute caps on link create, `/links/search`, insights, feed discovery, and provider model listing (`*_PER_MINUTE` in `.env`).
- ~~Per-user resource quotas~~ — `MAX_LINKS_PER_USER`, `MAX_FEEDS_PER_USER`, and a per-account storage-bytes cap tracked on `users.storage_bytes`.
- ~~Registration-abuse controls~~ — disposable-email blocking, a global daily signup ceiling, per-IP guards, and optional Cloudflare Turnstile.
- ~~Key-custody hardening~~ — envelope encryption with a documented `ENCRYPTION_KEY` rotation path (see [Security](../README.md#security)).
- ~~Embedding-load control~~ — bounded concurrency plus an optional standalone `embed-service/`, which Compose now runs by default.
- ~~Legal &amp; lifecycle~~ — Terms of Service and privacy policy under [legal/](legal/), `GET /api/account/export`, and `DELETE /api/account`.

What remains is operational, not code: pick a host, run it, and watch it. Not
committed to a date; tracked as the "Public hosted launch" block in
[requirements-full.md](requirements-full.md).

## AI productivity layer

The core bet: turn a growing pile of saved links into something queryable and self-surfacing. Mostly shipped.

- ~~Embeddings at save time (pgvector)~~ — `agent/embedding.py`, stored on `links.embedding`
- ~~Semantic search~~ — "that article about Go concurrency" without the title
- ~~Similar links~~ — related saves in the detail drawer
- ~~Topic explorer~~ — tags grouped on read into a queue-scoped topic rail
- **Resurface digest (next focus)** — AI-ranked weekly nudge of forgotten-but-relevant links, delivered as an in-app notification. Starts from nothing: `worker/daily_digest.py` was deleted with the Telegram integration, since sending that digest was all it did. Needs a new worker module, a cron registration in `WorkerSettings`, and a ranking query over `links.embedding` + `saved_at`.
- **Near-duplicate detection at save time** — the embeddings and the vector index are both already live; nothing consumes them for this yet. The cheapest of these three to start.
- ~~IVFFlat index on embeddings~~ — superseded: migration `0012_link_embedding` already creates an **HNSW** index (`idx_links_embedding_hnsw`, `m=16`, `ef_construction=64`, `vector_cosine_ops`). HNSW was chosen over IVFFlat because it needs no training step, so it is correct on an empty or partially embedded table. What is still unmeasured is whether the planner picks it once a `user_id` predicate narrows the set — measure before adding any further index.

## v0.2

- Browser extension for one-click save
- Data export (JSON, OPML for feeds)
- Better error visibility in the UI (AI failures, feed degradation)

## v0.3 (later)

- OAuth providers for login
- Mobile-friendly responsive polish
- "Ask your library" — RAG chat over saved links, grounded with citations

## Open ideas

- Webhook destinations for new feed items (Discord, Slack)
- iOS/Android share-sheet integration
- Per-feed AI prompt overrides

Got an idea? Open a [Discussion](https://github.com/Tanzimbn/Arciv/discussions).