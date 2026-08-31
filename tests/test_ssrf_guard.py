"""Outbound-fetch SSRF guard (NFR-PUB-04).

Every URL in this app comes from a user, and the api/worker containers can reach
the Docker network (Postgres, Redis, the embed service) and any cloud metadata
endpoint. ``api/utils/safe_fetch.py`` is the only thing between a submitted URL
and those hosts — and because ``fetch_article_text`` stores what it fetches, a
bypass hands the response body back to whoever submitted the URL.

Three properties have to hold together, so each is tested on its own:

1. Blocked addresses are rejected — judged after resolution, not by string shape.
2. Every redirect hop is re-checked, not just the first URL.
3. The connection is pinned to the address that was validated, so DNS can't
   change the answer between check and connect (rebinding).

``_resolve`` is patched throughout: a test asserting "this host is blocked" must
not pass merely because the name failed to resolve on the machine running it.
"""
import httpx
import pytest

from api.config import settings
from api.utils import safe_fetch
from api.utils.metadata import canonicalize_url, fetch_article_text, fetch_metadata
from api.utils.safe_fetch import (
    UnsafeURLError,
    parse_url,
    resolve_and_validate,
    safe_request,
)

PUBLIC_IP = "93.184.216.34"

# Addresses that must never be connected to. The first six are what the previous
# hand-rolled CIDR list let through, all verified to reach real infrastructure.
BLOCKED_ADDRESSES = [
    "127.0.0.1",            # loopback
    "::1",                  # loopback v6
    "::ffff:127.0.0.1",     # IPv4-mapped loopback — passed the old blocklist
    "0.0.0.0",              # all-interfaces; reaches localhost on Linux
    "fe80::1",              # link-local v6
    "169.254.169.254",      # cloud instance metadata
    "100.64.0.1",           # CGNAT
    "10.0.0.5",             # RFC1918
    "172.20.0.2",           # RFC1918 — the Compose network
    "192.168.1.1",          # RFC1918
    "fc00::1",              # unique-local v6
    "224.0.0.1",            # multicast
    "192.0.0.1",            # IETF protocol assignments
    "198.18.0.1",           # benchmarking
]

BAD_SCHEMES = [
    "file:///etc/passwd",
    "gopher://example.com/",
    "ftp://example.com/x",
    "data:text/html,<script>1</script>",
]


@pytest.fixture
def resolver(monkeypatch):
    """Control DNS. ``resolver.map[host] = [addr, ...]``; default is public."""

    class Resolver:
        def __init__(self):
            self.map: dict[str, list[str]] = {}
            self.default = [PUBLIC_IP]
            self.asked: list[str] = []

        async def __call__(self, host):
            self.asked.append(host)
            return self.map.get(host, self.default)

    r = Resolver()
    monkeypatch.setattr(safe_fetch, "_resolve", r)
    return r


@pytest.fixture
def fake_http(monkeypatch):
    """Answer real outbound requests from a handler, recording each request.

    Patches the same transport class as the ``no_network`` fixture, so nothing
    reaches the network; unlike ``no_network`` it can return a response, which is
    what the redirect and pinning tests need.
    """

    class FakeHTTP:
        def __init__(self):
            self.requests: list[httpx.Request] = []
            self.handler = lambda request: httpx.Response(200, text="ok")

        def last(self) -> httpx.Request:
            assert self.requests, "no outbound request was made"
            return self.requests[-1]

    fake = FakeHTTP()

    async def handle(transport_self, request):
        fake.requests.append(request)
        return fake.handler(request)

    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", handle)
    return fake


# --------------------------------------------------------------------------- #
# 1. Address policy
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("address", BLOCKED_ADDRESSES)
async def test_blocked_addresses_are_rejected(address, resolver):
    resolver.map["target.test"] = [address]
    with pytest.raises(UnsafeURLError, match="private/internal"):
        await resolve_and_validate(parse_url("http://target.test/"))


@pytest.mark.parametrize("address", BLOCKED_ADDRESSES)
async def test_blocked_addresses_are_rejected_as_literals(address, resolver):
    """The same policy must apply when the URL *is* the address.

    getaddrinfo normalises literals, which is also how the alternate spellings
    (2130706433, 0x7f000001, 127.1) get covered — they all resolve to 127.0.0.1.
    """
    host = f"[{address}]" if ":" in address else address
    resolver.map[address] = [address]
    with pytest.raises(UnsafeURLError, match="private/internal"):
        await resolve_and_validate(parse_url(f"http://{host}/"))


async def test_one_bad_address_among_several_rejects_the_whole_host(resolver):
    """A host answering with both a public and a private address is rejected.

    Which address the connection would have used isn't ours to predict, so
    "any blocked" is the rule, not "all blocked"."""
    resolver.map["split.test"] = [PUBLIC_IP, "127.0.0.1"]
    with pytest.raises(UnsafeURLError, match="private/internal"):
        await resolve_and_validate(parse_url("http://split.test/"))


@pytest.mark.parametrize("url", BAD_SCHEMES)
async def test_non_http_schemes_are_rejected(url, resolver):
    with pytest.raises(UnsafeURLError):
        await resolve_and_validate(parse_url(url))


async def test_url_without_hostname_is_rejected(resolver):
    with pytest.raises(UnsafeURLError, match="no hostname"):
        await resolve_and_validate(parse_url("http:///just-a-path"))


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com/post",
        "http://example.com:8080/post",
        "https://8.8.8.8/",  # public IP literal is fine
    ],
)
async def test_public_urls_pass(url, resolver):
    assert await resolve_and_validate(parse_url(url)) == PUBLIC_IP


async def test_hostnames_that_resolve_private_are_rejected(resolver):
    """Was ``test_known_gap_hostnames_are_not_resolved`` — now inverted.

    The old guard inspected IP literals only, so anything wearing a hostname
    walked through: rebinding services, wildcard DNS like nip.io, and the
    Compose service names themselves.
    """
    resolver.map = {
        "localtest.me": ["127.0.0.1"],
        "127.0.0.1.nip.io": ["127.0.0.1"],
        "db": ["172.20.0.2"],
        "redis": ["172.20.0.3"],
        "rebind.attacker.test": ["169.254.169.254"],
    }
    for host in resolver.map:
        with pytest.raises(UnsafeURLError, match="private/internal"):
            await resolve_and_validate(parse_url(f"http://{host}/"))


async def test_unresolvable_host_is_a_transport_error_not_a_rejection(monkeypatch):
    """A name that doesn't resolve is a connectivity fact, not a policy breach.

    It has to stay inside httpx's error hierarchy, because that's what makes a
    typo'd or dead domain degrade gracefully instead of becoming a hard 400.
    """
    import socket

    async def boom(host):
        raise socket.gaierror("nope")

    monkeypatch.setattr(safe_fetch, "_resolve", boom)
    with pytest.raises(httpx.RequestError):
        await resolve_and_validate(parse_url("http://nx.invalid/"))


async def test_host_resolving_to_nothing_is_a_transport_error(monkeypatch):
    async def empty(host):
        return []

    monkeypatch.setattr(safe_fetch, "_resolve", empty)
    with pytest.raises(httpx.RequestError):
        await resolve_and_validate(parse_url("http://void.test/"))


async def test_allow_private_network_fetch_reopens_the_lan(resolver, monkeypatch):
    """Self-hosters can opt back in; the default is off (see .env.example)."""
    resolver.map["nas.local"] = ["192.168.1.50"]
    monkeypatch.setattr(settings, "ALLOW_PRIVATE_NETWORK_FETCH", True)
    assert await resolve_and_validate(parse_url("http://nas.local/")) == "192.168.1.50"


# --------------------------------------------------------------------------- #
# 2. Redirects
# --------------------------------------------------------------------------- #

async def test_redirect_to_private_address_is_blocked(resolver, fake_http):
    """The hole that made every other check decorative.

    All fetchers used ``follow_redirects=True`` and validated only the first
    URL, so any public server could answer ``302 Location:
    http://169.254.169.254/`` and be followed.
    """
    resolver.map = {"public.test": [PUBLIC_IP], "meta.test": ["169.254.169.254"]}
    fake_http.handler = lambda request: httpx.Response(
        302, headers={"Location": "http://meta.test/latest/meta-data/"}
    )

    with pytest.raises(UnsafeURLError, match="private/internal"):
        await safe_request("GET", "http://public.test/start")

    assert len(fake_http.requests) == 1, "the redirect target was fetched anyway"


async def test_redirect_chain_is_capped(resolver, fake_http):
    fake_http.handler = lambda request: httpx.Response(
        302, headers={"Location": "http://public.test/next"}
    )
    with pytest.raises(httpx.TooManyRedirects):
        await safe_request("GET", "http://public.test/start", max_redirects=3)
    assert len(fake_http.requests) == 4  # the original plus three hops


async def test_final_url_is_logical_not_the_pinned_address(resolver, fake_http):
    """Guards the dedup regression pinning would otherwise cause.

    ``canonical_url`` is persisted under ``UNIQUE (user_id, canonical_url)``. If
    the returned URL were ``response.url`` it would be an IP, so the same article
    saved twice would produce two rows whenever DNS round-robins.
    """
    def handler(request):
        if request.url.path == "/start":
            return httpx.Response(301, headers={"Location": "/moved?utm_source=x"})
        return httpx.Response(200, text="ok")

    fake_http.handler = handler
    response, final_url = await safe_request("GET", "http://public.test/start")

    assert final_url == "http://public.test/moved?utm_source=x"
    assert str(response.url) == f"http://{PUBLIC_IP}/moved?utm_source=x"


# --------------------------------------------------------------------------- #
# 3. Connection pinning
# --------------------------------------------------------------------------- #

async def test_connection_is_pinned_to_the_validated_address(resolver, fake_http):
    """Closes DNS rebinding: the socket goes to the address that was checked.

    ``Host`` and ``sni_hostname`` keep the original hostname, so virtual hosting
    still routes and TLS is still verified against the real name rather than
    against an IP.
    """
    resolver.map["shifty.test"] = [PUBLIC_IP]
    await safe_request("GET", "http://shifty.test/page?a=1")

    request = fake_http.last()
    assert request.url.host == PUBLIC_IP
    assert request.url.path == "/page"
    assert request.headers["Host"] == "shifty.test"
    assert request.extensions["sni_hostname"] == "shifty.test"


async def test_pinning_preserves_a_non_default_port(resolver, fake_http):
    await safe_request("GET", "http://public.test:8080/page")

    request = fake_http.last()
    assert request.url.host == PUBLIC_IP
    assert request.url.port == 8080
    assert request.headers["Host"] == "public.test:8080"


async def test_resolution_happens_once_per_hop(resolver, fake_http):
    """One resolution per hop, and the connection uses its result.

    Re-resolving anywhere after the check would reintroduce the
    time-of-check/time-of-use gap that pinning exists to close.
    """
    def handler(request):
        if request.url.path == "/start":
            return httpx.Response(302, headers={"Location": "http://second.test/end"})
        return httpx.Response(200, text="ok")

    fake_http.handler = handler
    await safe_request("GET", "http://public.test/start")

    assert resolver.asked == ["public.test", "second.test"]


# --------------------------------------------------------------------------- #
# 4. The call sites
# --------------------------------------------------------------------------- #

async def test_fetch_metadata_reports_unreachable_instead_of_fetching(
    resolver, fake_http
):
    resolver.map["meta.test"] = ["169.254.169.254"]
    result = await fetch_metadata("http://meta.test/latest/meta-data/")

    assert result["fetch_status"] == "unreachable"
    assert result["title"] is None
    assert not fake_http.requests


async def test_fetch_article_text_returns_empty_for_blocked_url(resolver, fake_http):
    resolver.map["pg.test"] = ["172.20.0.2"]
    assert await fetch_article_text("http://pg.test:5432/") == ""
    assert not fake_http.requests


async def test_canonicalize_url_raises_for_blocked_url(resolver, fake_http):
    """Surfaced, not swallowed: POST /api/links turns this into a 400.

    Returning the URL unchanged would be worse than a rejection — the link would
    save and every later stage (metadata, AI insights, retry) would attack the
    same internal host again.
    """
    resolver.map["nope.test"] = ["127.0.0.1"]
    with pytest.raises(ValueError):
        await canonicalize_url("http://nope.test/")
    assert not fake_http.requests


async def test_canonicalize_url_keeps_the_hostname_after_redirects(
    resolver, fake_http
):
    def handler(request):
        if request.url.path == "/start":
            return httpx.Response(
                302, headers={"Location": "http://public.test/final/?utm_source=news"}
            )
        return httpx.Response(200, text="ok")

    fake_http.handler = handler
    assert await canonicalize_url("http://public.test/start") == (
        "http://public.test/final"
    )


async def test_canonicalize_url_keeps_an_unreachable_url_as_is(resolver, fake_http):
    """A dead domain must still save — this is what keeps the DNS-failure path
    a transport error rather than a rejection."""
    def handler(request):
        raise httpx.ConnectError("down", request=request)

    fake_http.handler = handler
    assert await canonicalize_url("http://public.test/x/") == "http://public.test/x"


async def test_discover_feed_rejects_a_blocked_url(resolver, fake_http):
    """Feed discovery had no guard at all — not even the old literal check —
    while making up to seven requests per call."""
    from api.utils.feed_discovery import discover_feed

    resolver.map["internal.test"] = ["10.0.0.5"]
    with pytest.raises(UnsafeURLError):
        await discover_feed("http://internal.test/")
    assert not fake_http.requests


async def test_seed_feed_history_does_not_fetch_a_blocked_url(resolver, fake_http):
    """Subscribing fetched the feed URL unguarded. It swallows every error, so
    the assertion is that nothing went out."""
    from api.models.feed import Feed
    from api.routers.feeds import _seed_feed_history

    resolver.map["internal.test"] = ["192.168.0.9"]
    feed = Feed(feed_url="http://internal.test/rss")

    await _seed_feed_history(None, feed)  # returns on the guard, never touches db

    assert not fake_http.requests


async def test_ollama_cloud_requests_are_pinned_and_carry_the_key(resolver, fake_http):
    """Ollama is the one provider we call over plain HTTP rather than an SDK.

    The base URL is a constant now, so this is no longer about SSRF — it is that
    every one of these requests carries the user's API key, and ``safe_fetch`` is
    what validates each redirect hop before the key travels over it. The
    connection targets the address that was checked, with the hostname preserved
    in the Host header, so a second DNS answer cannot redirect it (rebinding).
    """
    from agent.providers.ollama import OllamaProvider

    def handler(request):
        if request.url.path == "/api/ps":
            return httpx.Response(200, json={"models": []})
        return httpx.Response(200, json={"models": [{"name": "gpt-oss:120b"}]})

    fake_http.handler = handler

    models = await OllamaProvider("k3y").list_models()

    assert models == ["gpt-oss:120b"]
    assert [r.url.path for r in fake_http.requests] == ["/api/ps", "/api/tags"]
    for request in fake_http.requests:
        assert request.url.host == PUBLIC_IP           # pinned
        assert request.headers["host"] == "ollama.com"  # real name preserved
        assert request.headers["authorization"] == "Bearer k3y"


async def test_authorization_is_dropped_when_a_redirect_changes_origin(
    resolver, fake_http
):
    """A credential we attach must not leak to a third party.

    httpx strips credentials across origins itself, but ``_fetch_chain`` follows
    redirects by hand, so it has to reimplement that: a host (or anyone who takes
    over its DNS) answering ``302 Location: http://evil.test/`` would otherwise
    be handed the ``Authorization`` header on the next hop. The Ollama Cloud API
    key is the credential this currently protects.
    """
    resolver.map = {"upstream.test": [PUBLIC_IP], "evil.test": [PUBLIC_IP]}

    def handler(request):
        if request.headers["host"] == "upstream.test":
            return httpx.Response(302, headers={"Location": "http://evil.test/steal"})
        return httpx.Response(200, text="ok")

    fake_http.handler = handler

    await safe_request(
        "GET",
        "http://upstream.test/api/tags",
        headers={"Authorization": "Bearer s3cr3t", "Cookie": "sid=1"},
    )

    first, second = fake_http.requests
    assert first.headers["authorization"] == "Bearer s3cr3t"
    assert "authorization" not in second.headers
    assert "cookie" not in second.headers


async def test_authorization_survives_a_same_origin_redirect(resolver, fake_http):
    """Dropping it on every hop would break the ordinary case: a host that
    redirects ``/api/tags`` to ``/api/tags/`` is same-origin, and the credential
    is exactly what the next hop needs."""
    resolver.map["upstream.test"] = [PUBLIC_IP]
    hops = []

    def handler(request):
        hops.append(request)
        if len(hops) == 1:
            return httpx.Response(
                301, headers={"Location": "http://upstream.test/api/tags/"}
            )
        return httpx.Response(200, text="ok")

    fake_http.handler = handler

    await safe_request(
        "GET",
        "http://upstream.test/api/tags",
        headers={"Authorization": "Bearer s3cr3t"},
    )

    assert [r.headers.get("authorization") for r in fake_http.requests] == [
        "Bearer s3cr3t",
        "Bearer s3cr3t",
    ]


def test_no_module_fetches_a_user_url_outside_safe_fetch():
    """Drift guard: three fetchers reached production with no check because each
    call site rolled its own httpx client. A new one must not.

    If this fails, route the new fetch through ``safe_fetch.safe_request`` rather
    than adding the module to the allow-list.
    """
    import re
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    watched = [
        "api/utils/metadata.py",
        "api/utils/feed_discovery.py",
        "api/routers/links.py",
        "api/routers/feeds.py",
        "worker/feed_poll.py",
        # The URL is a constant, but every request carries the user's API key
        # and must keep safe_fetch's per-hop revalidation and credential strip.
        "agent/providers/ollama.py",
    ]
    direct_call = re.compile(r"\b(?:httpx|client)\.(?:get|post|stream|request)\(")

    offenders = []
    for rel in watched:
        for lineno, line in enumerate(
            (root / rel).read_text().splitlines(), start=1
        ):
            if direct_call.search(line):
                offenders.append(f"{rel}:{lineno}: {line.strip()}")

    assert not offenders, (
        "outbound fetch not going through safe_fetch.safe_request:\n"
        + "\n".join(offenders)
    )
