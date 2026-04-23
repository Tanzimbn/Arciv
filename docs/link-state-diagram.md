# Link State Diagram

## 1. `status` field — user lifecycle

```
User saves URL
      │
      ▼
┌─────────────┐
│   active    │  ◄── default on create
└─────────────┘
      │
      │  User clicks "Mark Done" (PATCH status=done)
      ▼
┌─────────────┐
│    done     │  ◄── appears in ?queue=archive
└─────────────┘
```

> Hard delete (DELETE /api/links/:id) removes row entirely — no "deleted" status exists yet.

---

## 2. `queue` field — where link lives in reading list

```
User saves URL
      │
      ▼
  classify_by_url()        ← heuristic runs IMMEDIATELY (sync, no AI)
      │
      ├── youtube.com / vimeo.com  ──────────► queue = "watch-later"
      ├── github.com / npmjs.com   ──────────► queue = "try-later"
      ├── arxiv.org / substack.com ──────────► queue = "read-later"
      ├── URL unreachable          ──────────► queue = "inbox"
      └── anything else            ──────────► queue = "read-later"
      │
      │   (AI job enqueued async — may overwrite later)
      ▼
  classify_link() worker   ← AI runs LATER in background
      │
      ├── AI success  ──────────────────────► queue = AI decision
      │                                       (watch-later / read-later /
      │                                        try-later)
      └── AI parse fail (skipped) ──────────► queue stays as heuristic set it
      
      
  User can always override:
  PATCH /api/links/:id  { queue: "watch-later" }  ──► queue = user choice
```

---

## 3. `ai_status` field — AI pipeline state

```
Link created
      │
      ▼
┌───────────┐
│  pending  │  ◄── default, job enqueued
└───────────┘
      │
      │  ARQ worker picks up job
      ▼
┌────────────┐
│ processing │
└────────────┘
      │
      ├── SUCCESS ──────────────────────────► ai_status = "done"
      │                                       queue updated by AI
      │
      ├── AI returns bad JSON (ParseError) ─► ai_status = "skipped"
      │                                       queue stays as heuristic
      │
      ├── Auth error (401/403) ────────────► ai_status = "failed"
      │                                       no retry
      │
      └── Quota / network error
                │
                │  attempt < 4 → retry with backoff
                │  2min → 10min → 1hr
                ▼
          ┌───────────┐
          │  pending  │  (re-enqueued)
          └───────────┘
                │
                │  attempt == 4
                ▼
          ┌────────┐
          │ failed │  ◄── sweep job requeues hourly
          └────────┘        OR user hits POST /retry-ai
```

---

## 4. All three fields together — full picture

```
POST /api/links
        │
        ▼
  ┌─────────────────────────────────────┐
  │  Link created                       │
  │  status    = "active"               │
  │  queue     = <heuristic guess>      │
  │  ai_status = "pending"              │
  └─────────────────────────────────────┘
        │
        │  Background AI job runs
        ▼
  ┌─────────────────────────────────────┐
  │  AI done                            │
  │  status    = "active"  (unchanged)  │
  │  queue     = <AI decision>          │
  │  ai_status = "done"                 │
  └─────────────────────────────────────┘
        │
        │  User reads it, clicks Done
        ▼
  ┌─────────────────────────────────────┐
  │  Archived                           │
  │  status    = "done"                 │
  │  queue     = <whatever it was>      │
  │  ai_status = "done"                 │
  └─────────────────────────────────────┘


GET /api/links               → status="active"  (all queues)
GET /api/links?queue=inbox   → status="active" AND queue="inbox"
GET /api/links?queue=archive → status="done"   (special alias)
```
