"""The single outbound HTTP path for user-supplied URLs.

Every URL this app fetches comes from a user, and the api/worker containers can
reach Postgres, Redis, the embed service, and the cloud instance-metadata
endpoint. ``fetch_article_text`` *stores* what it fetches, so an unguarded fetch
is not a blind side effect — the response body comes back to whoever submitted
the URL.

Guarding each call site separately is what previously left three fetchers
(feed discovery, feed-history seeding, feed polling) with no check at all. So
there is one entry point, ``safe_request``, and the rule is: if a URL came from a
user, it is fetched through here.

Three things have to hold at once, and missing any one of them defeats the other
two:

1. **Resolve, don't pattern-match.** A hand-rolled list of private CIDRs misses
   IPv4-mapped IPv6 (``::ffff:127.0.0.1``), ``0.0.0.0``, link-local, CGNAT, and
   every alternate literal spelling (``2130706433``, ``0x7f000001``, ``127.1``
   all reach 127.0.0.1). Resolving the host and judging the *addresses* covers
   all of it, because getaddrinfo normalises the spellings for us.
2. **Check every hop.** With ``follow_redirects=True`` and a check only on the
   first URL, any public server can reply ``302 Location:
   http://169.254.169.254/`` and walk straight through the guard.
3. **Pin the connection.** Validating a hostname and then letting httpx resolve
   it again is a time-of-check/time-of-use bug: attacker-controlled DNS with a
   short TTL answers public for our check and private for the real connection
   (DNS rebinding). So we connect to the address we validated, and carry the
   original hostname in the ``Host`` header and TLS SNI.
"""
from __future__ import annotations

import asyncio
import ipaddress
import socket
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx

from api.config import settings

# Ranges Python's own address properties don't classify but which have no
# business being fetched from a link manager.
_EXTRA_BLOCKED = [
    ipaddress.ip_network("100.64.0.0/10"),   # CGNAT — carrier-side infrastructure
    ipaddress.ip_network("192.0.0.0/24"),    # IETF protocol assignments
    ipaddress.ip_network("198.18.0.0/15"),   # benchmarking
]

_REDIRECT_STATUSES = {301, 302, 303, 307, 308}


class UnsafeURLError(ValueError):
    """A URL was rejected before any connection was made.

    Subclasses ValueError because that is what the previous guard raised and
    callers already handle it that way.
    """


def _is_blocked_address(raw: str) -> bool:
    """Judge a resolved address, not a hostname or a URL."""
    try:
        addr = ipaddress.ip_address(raw)
    except ValueError:
        # Not parseable as an address at all — refuse rather than guess.
        return True

    # ::ffff:127.0.0.1 is loopback wearing an IPv6 costume; unwrap before judging.
    mapped = getattr(addr, "ipv4_mapped", None)
    if mapped is not None:
        addr = mapped

    return (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_reserved
        or addr.is_multicast
        or addr.is_unspecified
        or any(addr in net for net in _EXTRA_BLOCKED)
    )


async def _resolve(host: str) -> list[str]:
    """Resolve a hostname to every address it answers with.

    Module-level and deliberately small so tests can patch it — the suite must
    not depend on real DNS, and a test asserting "this hostname is blocked"
    should not silently pass because the name failed to resolve.
    """
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    return [info[4][0] for info in infos]


def parse_url(url: str) -> httpx.URL:
    """Parse without leaking httpx's own ``InvalidURL``, which isn't a ValueError.

    Callers catch ``ValueError`` to turn a bad URL into a 400; an exception
    outside that hierarchy would become a 500 instead.
    """
    try:
        return httpx.URL(url)
    except httpx.InvalidURL as exc:
        raise UnsafeURLError(f"Malformed URL: {url!r}") from exc


async def resolve_and_validate(url: httpx.URL) -> str:
    """Check one URL and return the address to connect to.

    Rejects if *any* resolved address is blocked, not merely if all of them are:
    a host answering with one public and one private address would otherwise be
    a free pass, and which address httpx picks is not ours to predict.
    """
    if url.scheme not in ("http", "https"):
        raise UnsafeURLError(f"Unsupported URL scheme: {url.scheme!r}")

    host = url.host
    if not host:
        raise UnsafeURLError("URL has no hostname")

    # A name that doesn't resolve is a connectivity fact, not a policy violation,
    # so it's raised as a transport error: callers already degrade gracefully on
    # those (canonicalize_url keeps the original URL, metadata reports
    # "unreachable"), and a typo'd domain should not become a hard rejection.
    try:
        addresses = await _resolve(host)
    except socket.gaierror as exc:
        raise httpx.ConnectError(f"Could not resolve host {host!r}") from exc

    if not addresses:
        raise httpx.ConnectError(f"Host {host!r} resolved to no addresses")

    if settings.ALLOW_PRIVATE_NETWORK_FETCH:
        return addresses[0]

    for address in addresses:
        if _is_blocked_address(address):
            raise UnsafeURLError(
                "Requests to private/internal addresses are not allowed"
            )

    return addresses[0]


def _pin(url: httpx.URL, address: str) -> tuple[httpx.URL, dict[str, str]]:
    """Rewrite a URL to connect to ``address`` while still addressing its host.

    The ``Host`` header keeps the port when it is non-default, matching what
    httpx would have sent, so virtual-host routing still works. ``sni_hostname``
    makes httpcore use the real hostname both for SNI and for certificate
    verification (``_async/connection.py``: ``server_hostname = sni_hostname or
    origin.host``) — pinning must not quietly downgrade TLS to "valid for an IP".
    """
    host_header = url.netloc.decode("ascii")
    return url.copy_with(host=address), {"Host": host_header}


# Headers that must not survive a hop to a different origin. httpx strips these
# itself when it follows redirects, but we do our own following (to validate and
# pin each hop), so we have to reimplement it: an Ollama server answering 302 to
# a third party would otherwise hand that third party the user's access token.
_CREDENTIAL_HEADERS = ("authorization", "cookie", "proxy-authorization")


def _origin(url: httpx.URL) -> tuple[bytes, bytes, int | None]:
    return url.raw_scheme, url.raw_host, url.port


def _drop_credentials(headers: dict[str, str]) -> dict[str, str]:
    return {k: v for k, v in headers.items() if k.lower() not in _CREDENTIAL_HEADERS}


async def _fetch_chain(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    headers: dict[str, str] | None,
    max_redirects: int,
    stream: bool,
    json_body: object | None = None,
) -> tuple[httpx.Response, str]:
    """Walk the redirect chain, validating and pinning each hop.

    Returns ``(response, final_logical_url)``. The logical URL is tracked
    separately from ``response.url`` because the latter is the pinned IP — see
    ``safe_request``.
    """
    current = parse_url(url)
    headers = dict(headers or {})

    for _ in range(max_redirects + 1):
        address = await resolve_and_validate(current)
        pinned, host_headers = _pin(current, address)

        request = client.build_request(
            method,
            pinned,
            headers={**headers, **host_headers},
            json=json_body,
            extensions={"sni_hostname": current.host},
        )
        response = await client.send(request, stream=stream, follow_redirects=False)

        location = response.headers.get("Location")
        if response.status_code not in _REDIRECT_STATUSES or not location:
            return response, str(current)

        await response.aclose()
        # Standard redirect semantics, matching httpx and browsers: 301/302/303
        # turn a non-idempotent request into a GET and drop its body; only
        # 307/308 replay method and body. Getting this wrong would re-POST a
        # payload to a host we were merely pointed at.
        if response.status_code in (301, 302, 303) and method.upper() not in ("GET", "HEAD"):
            method = "GET"
            json_body = None
        # Join against the *logical* URL, so a relative Location can't be
        # re-anchored onto the pinned address.
        nxt = current.join(location)
        if _origin(nxt) != _origin(current):
            headers = _drop_credentials(headers)
        current = nxt

    raise httpx.TooManyRedirects(
        f"Exceeded {max_redirects} redirects fetching {url}",
        request=httpx.Request(method, url),
    )


async def safe_request(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    timeout: float = 10.0,
    max_redirects: int | None = None,
    client: httpx.AsyncClient | None = None,
    json: object | None = None,
) -> tuple[httpx.Response, str]:
    """Fetch ``url`` with the body read, validating and pinning every hop.

    Returns ``(response, final_url)`` where ``final_url`` is the **logical** URL
    — hostname-based, not the pinned address. ``response.url`` is the IP we
    connected to; persisting that would write IP-based canonical URLs into the
    database and silently break ``UNIQUE (user_id, canonical_url)`` dedup.

    Raises ``UnsafeURLError`` if any hop resolves somewhere it shouldn't, and
    ``httpx.TooManyRedirects`` past the hop limit. Transport errors propagate as
    the usual httpx exceptions — callers already handle those.

    Pass ``client`` to reuse one connection pool across several fetches (feed
    discovery probes a handful of paths); ownership stays with the caller then.

    ``json`` sends a JSON request body — needed by the Ollama provider, whose
    ``base_url`` is user-supplied and so has to come through here too.
    """
    if max_redirects is None:
        max_redirects = settings.MAX_FETCH_REDIRECTS

    owns_client = client is None
    if client is None:
        client = httpx.AsyncClient(follow_redirects=False, timeout=timeout)
    try:
        return await _fetch_chain(
            client, method, url, headers, max_redirects, False, json_body=json
        )
    finally:
        if owns_client:
            await client.aclose()


@asynccontextmanager
async def safe_stream(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    timeout: float = 10.0,
    max_redirects: int | None = None,
) -> AsyncIterator[tuple[httpx.Response, str]]:
    """Same guarantees as ``safe_request``, without downloading the body.

    ``canonicalize_url`` only needs where a URL ends up, so it has no reason to
    pull a whole page over the wire.
    """
    if max_redirects is None:
        max_redirects = settings.MAX_FETCH_REDIRECTS

    async with httpx.AsyncClient(follow_redirects=False, timeout=timeout) as client:
        response, final_url = await _fetch_chain(
            client, method, url, headers, max_redirects, True
        )
        try:
            yield response, final_url
        finally:
            await response.aclose()
