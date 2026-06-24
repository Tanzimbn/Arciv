# Auth Hardening Plan (Production-Ready Authentication)

> Status: **planned, not implemented.** Captured 2026-06-23 for later execution.

## Context

Current auth (`api/routers/auth.py`) is minimal: register returns a JWT immediately with no
email verification, login issues a single 7-day bearer JWT with no refresh/revocation, and there
is no password reset, rate limiting, or password-strength enforcement. No email infrastructure
exists. Goal: harden auth to production grade for a self-hostable app.

**Decisions:**
- Email delivery: **SMTP** (self-host friendly) via `aiosmtplib`.
- Verification: **block login until verified**.
- Tokens: **short-lived access + DB-backed refresh token with rotation & revocation**.
- Extra: **rate limiting** + **password strength rules**.
- Included as a necessity: **resend-verification** (block-until-verified is unusable without it).

---

## 1. Email infrastructure (SMTP)

**New `api/utils/mailer.py`** — async send via `aiosmtplib`, Jinja2-rendered HTML + text.
- Templates in `api/templates/email/`: `verify_email.html`, `reset_password.html` (+ `.txt`).
- `async def send_email(to, subject, template, ctx)`.
- If `EMAIL_ENABLED=false`, log the link instead of sending (local dev without SMTP).

**Config additions** (`api/config.py`): `EMAIL_ENABLED`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_STARTTLS` (bool), `APP_BASE_URL` (build links). Document all in
`.env.example`. Add `MailHog` service to `docker-compose.yml` for local dev (catches mail at :8025).

**Send via worker, not request thread.** Add ARQ job `send_email_job` in a new
`worker/email.py`; register in `worker/worker.py` `WorkerSettings.functions`. Auth endpoints
enqueue the job (reuse the existing ARQ Redis pool pattern used by links). Gives retries + keeps
register/forgot responses fast.

**Deps** (`requirements.txt`): `aiosmtplib`, `jinja2`, `slowapi`. (`pydantic[email]` already present.)

## 2. Data model

**Migration `0006_auth_hardening.py`** (do not edit existing migrations):
- `users`: add `email_verified BOOLEAN NOT NULL DEFAULT false`, `email_verified_at TIMESTAMPTZ NULL`.
  Backfill existing rows to `true` (don't lock out current users).
- New table `refresh_tokens`: `id UUID pk`, `user_id FK→users ON DELETE CASCADE`,
  `token_hash CHAR(64)` (SHA-256, unique, indexed), `expires_at TIMESTAMPTZ`,
  `revoked BOOLEAN default false`, `created_at`, optional `user_agent`/`ip`.

Update `api/models/user.py` (new columns) and add `api/models/refresh_token.py`.

**Email-verification & password-reset tokens → Redis** (self-expiring, single-use, no migration):
key `verify:<sha256>` / `reset:<sha256>` → `user_id`, TTL 24h / 1h. Store only the hash; the raw
token goes in the emailed link. Consume = `GETDEL`.

## 3. Token lifecycle

`api/middleware/auth.py`:
- `ACCESS_TOKEN_EXPIRE_MINUTES` → 15 (config default).
- Add `create_refresh_token(user)` → random `secrets.token_urlsafe(32)`, store SHA-256 hash row,
  return raw token. `rotate_refresh_token(raw)` → validate (exists, not revoked, not expired),
  revoke old, issue new (rotation). `revoke_refresh_token` / `revoke_all_for_user`.
- Access JWT keeps `sub`; add `type:"access"`.

`TokenResponse` schema gains `refresh_token` and `expires_in`.

## 4. Endpoints (`api/routers/auth.py`)

- `POST /register` — validate password, create **unverified** user, enqueue verify email,
  return `201 {message}` (**no token**).
- `POST /verify-email` `{token}` — consume Redis token, set `email_verified=true`.
- `POST /resend-verification` `{email}` — enqueue if unverified; **always** generic 200 (no enumeration).
- `POST /login` — reject if `not email_verified` (403 "Email not verified"); else return access+refresh.
- `POST /refresh` `{refresh_token}` — rotate, return new pair.
- `POST /logout` `{refresh_token}` — revoke that token.
- `POST /forgot-password` `{email}` — enqueue reset email; **always** generic 200.
- `POST /reset-password` `{token, new_password}` — validate strength, set hash,
  `revoke_all_for_user` (kill existing sessions).
- `GET /me` — unchanged.

New schemas in `api/schemas/auth.py` for each body + a shared password validator.

## 5. Password strength

Pydantic field validator (shared, e.g. `api/utils/security.py:validate_password_strength`): min 12
chars, at least one upper, lower, digit. Applied in `RegisterRequest` and `ResetPasswordRequest`.

## 6. Rate limiting

`slowapi` with Redis storage (`REDIS_URL`). Register limiter on app in `api/main.py`. Limits:
`login` 5/min/IP, `register` 3/hr/IP, `forgot-password` & `resend-verification` 3/hr/IP,
`reset-password`/`verify-email` 10/hr/IP. Returns 429 on breach.

## 7. Frontend (`frontend/src/`)

- `LoginView.jsx`: register now shows "check your email"; login surfaces "not verified" with a
  resend link. Add `ForgotPasswordView`, `ResetPasswordView`, `VerifyEmailView` (read `?token=`).
- `api/client.js`: store `refresh_token`; on 401, call `/refresh` once and retry; clear on logout.
- Add routes for `/verify-email`, `/reset-password`, `/forgot-password`.

---

## Files

**New:** `api/utils/mailer.py`, `api/templates/email/*`, `worker/email.py`,
`api/models/refresh_token.py`, `db/migrations/versions/0006_auth_hardening.py`,
frontend views above.
**Modified:** `api/routers/auth.py`, `api/schemas/auth.py`, `api/middleware/auth.py`,
`api/models/user.py`, `api/config.py`, `api/main.py`, `api/utils/security.py`,
`worker/worker.py`, `requirements.txt`, `.env.example`, `docker-compose.yml`,
`frontend/src/api/client.js`, `frontend/src/App` router.

## Verification

1. `docker compose up` (incl. MailHog) → `alembic upgrade head` runs clean; existing users
   backfilled `email_verified=true`.
2. Register a new user → 201, no token; verify email lands in MailHog (:8025).
3. Login before verifying → 403. Click verify link → `email_verified=true`. Login → access+refresh.
4. `POST /refresh` rotates (old refresh token now rejected). `POST /logout` revokes.
5. `forgot-password` → reset mail; `reset-password` sets new password and kills old sessions.
6. Weak password → 422. Hammer `/login` >5/min → 429.
7. `EMAIL_ENABLED=false` → links logged to stdout (no SMTP needed).
