"""Email sending with Jinja2-rendered HTML + plain-text templates.

Two delivery backends, chosen at send time:

* **Gmail API (HTTPS)** — used when ``GMAIL_REFRESH_TOKEN`` is set. Sends over
  port 443, so it works on hosts that block outbound SMTP (e.g. Render's free
  tier blocks 25/465/587). Mail originates from the authenticated Gmail account.
* **SMTP** — used otherwise (local dev with MailHog, or self-hosts that allow
  SMTP egress).

When ``settings.EMAIL_ENABLED`` is false the email is not sent; instead the
rendered link context is logged. This keeps local dev working without any mail
server (and surfaces verification / reset links in the worker logs).
"""
import base64
import logging
import time
from email.message import EmailMessage
from pathlib import Path

import aiosmtplib
import httpx
from jinja2 import Environment, FileSystemLoader, select_autoescape

from api.config import settings

logger = logging.getLogger("arciv.mailer")

_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"

# Cached OAuth2 access token: (token, expires_at_epoch). Refresh tokens are
# long-lived; access tokens last ~1h, so we exchange once and reuse.
_access_token: tuple[str, float] | None = None

_TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "templates" / "email"
_env = Environment(
    loader=FileSystemLoader(str(_TEMPLATE_DIR)),
    autoescape=select_autoescape(["html"]),
)


def _render(template: str, ctx: dict) -> str:
    return _env.get_template(template).render(**ctx)


async def _gmail_access_token() -> str:
    """Exchange the long-lived refresh token for a short-lived access token.

    Cached in-process until ~60s before expiry to avoid a token call per email.
    """
    global _access_token
    if _access_token is not None and _access_token[1] > time.time():
        return _access_token[0]

    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            _GOOGLE_TOKEN_URL,
            data={
                "client_id": settings.GMAIL_CLIENT_ID,
                "client_secret": settings.GMAIL_CLIENT_SECRET,
                "refresh_token": settings.GMAIL_REFRESH_TOKEN,
                "grant_type": "refresh_token",
            },
        )
    resp.raise_for_status()
    data = resp.json()
    token = data["access_token"]
    expires_at = time.time() + int(data.get("expires_in", 3600)) - 60
    _access_token = (token, expires_at)
    return token


async def _send_gmail_api(message: EmailMessage) -> None:
    """Send a built MIME message via the Gmail REST API over HTTPS (port 443)."""
    token = await _gmail_access_token()
    raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            _GMAIL_SEND_URL,
            headers={"Authorization": f"Bearer {token}"},
            json={"raw": raw},
        )
    resp.raise_for_status()


async def _send_smtp(message: EmailMessage, to: str) -> None:
    await aiosmtplib.send(
        message,
        hostname=settings.SMTP_HOST,
        port=settings.SMTP_PORT,
        username=settings.SMTP_USER or None,
        password=settings.SMTP_PASSWORD or None,
        start_tls=settings.SMTP_STARTTLS,
    )


async def send_email(to: str, subject: str, template: str, ctx: dict) -> None:
    """Render ``<template>.html`` + ``<template>.txt`` and send to ``to``.

    Uses the Gmail API when ``GMAIL_REFRESH_TOKEN`` is set, else SMTP.
    No-op (logs the context) when EMAIL_ENABLED is false.
    """
    html_body = _render(f"{template}.html", ctx)
    text_body = _render(f"{template}.txt", ctx)

    if not settings.EMAIL_ENABLED:
        logger.info(
            "EMAIL_ENABLED=false; not sending %r to %s. Context: %s",
            subject, to, ctx,
        )
        return

    message = EmailMessage()
    message["From"] = settings.SMTP_FROM
    message["To"] = to
    message["Subject"] = subject
    message.set_content(text_body)
    message.add_alternative(html_body, subtype="html")

    if settings.GMAIL_REFRESH_TOKEN:
        await _send_gmail_api(message)
        logger.info("Sent %r to %s via Gmail API", subject, to)
    else:
        await _send_smtp(message, to)
        logger.info("Sent %r to %s via SMTP", subject, to)