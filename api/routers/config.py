"""Public runtime config for the SPA.

Unauthenticated by design — it exposes only values the browser legitimately
needs before login (the public Turnstile site key and whether the signup captcha
is on). Never put a secret here.
"""
from fastapi import APIRouter

from api.config import settings

router = APIRouter()


@router.get("")
async def public_config():
    return {
        "signup_captcha_enabled": bool(settings.TURNSTILE_SECRET_KEY),
        "turnstile_site_key": settings.TURNSTILE_SITE_KEY,
    }
