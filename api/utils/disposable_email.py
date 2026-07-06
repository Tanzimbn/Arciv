"""Static blocklist of throwaway/disposable email domains.

Intentionally in-repo and offline — no network lookup — so it works for
self-hosters and can't add latency or a failure mode to signup. This is a
curated sample of the most common disposable providers, not exhaustive; it
raises the cost of automated mass-signup without pretending to be complete.
Gated behind settings.BLOCK_DISPOSABLE_EMAILS (off by default).
"""

DISPOSABLE_DOMAINS: frozenset[str] = frozenset(
    {
        "10minutemail.com",
        "20minutemail.com",
        "33mail.com",
        "discard.email",
        "dispostable.com",
        "fakeinbox.com",
        "getairmail.com",
        "getnada.com",
        "guerrillamail.com",
        "guerrillamail.info",
        "guerrillamail.net",
        "guerrillamail.org",
        "inboxbear.com",
        "mailcatch.com",
        "maildrop.cc",
        "mailinator.com",
        "mailnesia.com",
        "mintemail.com",
        "moakt.com",
        "mohmal.com",
        "mytemp.email",
        "sharklasers.com",
        "spam4.me",
        "temp-mail.org",
        "tempmail.com",
        "tempmailo.com",
        "tempr.email",
        "throwawaymail.com",
        "trashmail.com",
        "yopmail.com",
        "yopmail.net",
    }
)


def is_disposable(email: str) -> bool:
    """True if the email's domain is a known disposable provider."""
    _, _, domain = email.rpartition("@")
    return domain.strip().lower() in DISPOSABLE_DOMAINS
