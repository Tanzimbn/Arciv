"""Signup abuse guards (NFR-PUB-02).

The captcha is the interesting one: it must be *off* for self-hosters and *fail
closed* for the hosted instance. A Cloudflare outage that silently turns the
captcha into a no-op is the failure mode this file exists to prevent.
"""
import httpx
import pytest

from api.utils.disposable_email import DISPOSABLE_DOMAINS, is_disposable
from api.utils.turnstile import verify_turnstile


@pytest.mark.parametrize(
    "email",
    [
        "a@mailinator.com",
        "a@guerrillamail.com",
        "a@10minutemail.com",
        "A@YOPMAIL.COM",          # case-insensitive
        "a@trashmail.com ",       # trailing whitespace
        "weird+tag@temp-mail.org",
    ],
)
def test_disposable_domains_detected(email):
    assert is_disposable(email) is True


@pytest.mark.parametrize(
    "email",
    [
        "a@gmail.com",
        "a@kitegamesstudio.com",
        "a@sub.mailinator.com.example",  # not the blocked domain
        "no-at-sign",
    ],
)
def test_legitimate_addresses_pass(email):
    assert is_disposable(email) is False


def test_blocklist_entries_are_normalised():
    """A stray uppercase or whitespace entry would be permanently unmatchable,
    since lookups lowercase+strip the candidate but not the list."""
    for domain in DISPOSABLE_DOMAINS:
        assert domain == domain.strip().lower()
        assert "@" not in domain


# --------------------------------------------------------------------------- #
# Turnstile
# --------------------------------------------------------------------------- #
async def test_captcha_disabled_passes_without_a_token(monkeypatch, no_network):
    """Self-host default: no secret configured, signup must not require a token.
    `no_network` proves we don't even call Cloudflare in this mode."""
    from api.config import settings

    monkeypatch.setattr(settings, "TURNSTILE_SECRET_KEY", "")
    assert await verify_turnstile(None, "1.2.3.4") is True


async def test_enabled_captcha_rejects_a_missing_token(monkeypatch, no_network):
    from api.config import settings

    monkeypatch.setattr(settings, "TURNSTILE_SECRET_KEY", "secret")
    assert await verify_turnstile(None, "1.2.3.4") is False
    assert await verify_turnstile("", "1.2.3.4") is False


@pytest.mark.parametrize(
    "payload,expected",
    [
        ({"success": True}, True),
        ({"success": False, "error-codes": ["invalid-input-response"]}, False),
        ({}, False),                 # malformed response is a failure
        ({"success": "yes"}, True),  # truthy per bool()
    ],
)
async def test_verification_result_follows_cloudflare(monkeypatch, payload, expected):
    from api.config import settings
    from api.utils import turnstile as ts

    monkeypatch.setattr(settings, "TURNSTILE_SECRET_KEY", "secret")

    sent = {}

    class _Client:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, data=None):
            sent["url"] = url
            sent["data"] = data
            return httpx.Response(200, json=payload)

    monkeypatch.setattr(ts.httpx, "AsyncClient", _Client)
    assert await verify_turnstile("token-123", "9.9.9.9") is expected
    assert sent["url"] == ts._SITEVERIFY_URL
    assert sent["data"] == {"secret": "secret", "response": "token-123", "remoteip": "9.9.9.9"}


async def test_network_failure_fails_closed(monkeypatch):
    """A Cloudflare outage must block signups, not wave them through."""
    from api.config import settings
    from api.utils import turnstile as ts

    monkeypatch.setattr(settings, "TURNSTILE_SECRET_KEY", "secret")

    class _Client:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, data=None):
            raise httpx.ConnectTimeout("cloudflare unreachable")

    monkeypatch.setattr(ts.httpx, "AsyncClient", _Client)
    assert await verify_turnstile("token-123", None) is False


async def test_unparseable_body_fails_closed(monkeypatch):
    from api.config import settings
    from api.utils import turnstile as ts

    monkeypatch.setattr(settings, "TURNSTILE_SECRET_KEY", "secret")

    class _Client:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, data=None):
            return httpx.Response(200, text="<html>an error page</html>")

    monkeypatch.setattr(ts.httpx, "AsyncClient", _Client)
    assert await verify_turnstile("token-123", None) is False
