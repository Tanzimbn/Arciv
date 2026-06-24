"""ARQ job that sends a transactional email off the request thread.

Auth endpoints enqueue this so register / forgot-password return fast and email
sending gets ARQ's retry handling.
"""
from api.utils.mailer import send_email


async def send_email_job(ctx, to: str, subject: str, template: str, context: dict) -> None:
    await send_email(to, subject, template, context)