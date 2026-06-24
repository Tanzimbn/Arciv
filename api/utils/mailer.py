"""SMTP email sending with Jinja2-rendered HTML + plain-text templates.

When ``settings.EMAIL_ENABLED`` is false the email is not sent; instead the
rendered link context is logged. This keeps local dev working without an SMTP
server (and surfaces verification / reset links in the worker logs).
"""
import logging
from email.message import EmailMessage
from pathlib import Path

import aiosmtplib
from jinja2 import Environment, FileSystemLoader, select_autoescape

from api.config import settings

logger = logging.getLogger("arciv.mailer")

_TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "templates" / "email"
_env = Environment(
    loader=FileSystemLoader(str(_TEMPLATE_DIR)),
    autoescape=select_autoescape(["html"]),
)


def _render(template: str, ctx: dict) -> str:
    return _env.get_template(template).render(**ctx)


async def send_email(to: str, subject: str, template: str, ctx: dict) -> None:
    """Render ``<template>.html`` + ``<template>.txt`` and send to ``to``.

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

    await aiosmtplib.send(
        message,
        hostname=settings.SMTP_HOST,
        port=settings.SMTP_PORT,
        username=settings.SMTP_USER or None,
        password=settings.SMTP_PASSWORD or None,
        start_tls=settings.SMTP_STARTTLS,
    )
    logger.info("Sent %r to %s", subject, to)