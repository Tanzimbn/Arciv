"""Cloudflare Turnstile captcha verification for signup.

Disabled (always passes) when TURNSTILE_SECRET_KEY is empty — the self-host
default. When a secret is configured we fail closed: a missing token or a
verification error rejects the signup, so a Cloudflare outage can't be used to
bypass the captcha.
"""
import httpx

from api.config import settings

_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


async def verify_turnstile(token: str | None, remote_ip: str | None) -> bool:
    if not settings.TURNSTILE_SECRET_KEY:
        return True  # captcha disabled
    if not token:
        return False
    data = {"secret": settings.TURNSTILE_SECRET_KEY, "response": token}
    if remote_ip:
        data["remoteip"] = remote_ip
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(_SITEVERIFY_URL, data=data)
        return bool(resp.json().get("success", False))
    except Exception:
        # Fail closed — never let a network/parse error wave a signup through.
        return False
