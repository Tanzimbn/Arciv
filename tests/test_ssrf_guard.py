"""Outbound-fetch SSRF guard (NFR-PUB-04).

Every URL in this app comes from a user, and the API can reach the Docker network
(Postgres, Redis, the embed service) and any cloud metadata endpoint. The guard in
api/utils/metadata.py is the only thing between a submitted URL and those hosts.
"""
import pytest

from api.utils.metadata import _assert_safe_url, fetch_article_text, fetch_metadata

PRIVATE_URLS = [
    "http://127.0.0.1:8000/admin",
    "http://127.1.2.3/",
    "http://10.0.0.5/latest/meta-data/",
    "http://172.16.31.9/",
    "http://172.20.0.2:5432/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",  # cloud instance metadata
    "http://[::1]:6379/",
    "http://[fc00::1]/",
]

BAD_SCHEMES = [
    "file:///etc/passwd",
    "gopher://example.com/",
    "ftp://example.com/x",
    "data:text/html,<script>1</script>",
]


@pytest.mark.parametrize("url", PRIVATE_URLS)
def test_private_ip_literals_are_rejected(url):
    with pytest.raises(ValueError, match="private/internal"):
        _assert_safe_url(url)


@pytest.mark.parametrize("url", BAD_SCHEMES)
def test_non_http_schemes_are_rejected(url):
    with pytest.raises(ValueError):
        _assert_safe_url(url)


def test_url_without_hostname_is_rejected():
    with pytest.raises(ValueError, match="no hostname"):
        _assert_safe_url("http:///just-a-path")


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com/post",
        "http://example.com:8080/post",
        "https://8.8.8.8/",  # public IP literal is fine
    ],
)
def test_public_urls_pass(url):
    _assert_safe_url(url)  # must not raise


async def test_fetch_metadata_reports_unreachable_instead_of_fetching(no_network):
    """The guard must short-circuit before any request goes out; ``no_network``
    turns a leak into a failure instead of a real connection to the metadata IP."""
    result = await fetch_metadata("http://169.254.169.254/latest/meta-data/")
    assert result["fetch_status"] == "unreachable"
    assert result["title"] is None


async def test_fetch_article_text_returns_empty_for_blocked_url(no_network):
    assert await fetch_article_text("http://127.0.0.1:5432/") == ""


def test_known_gap_hostnames_are_not_resolved():
    """Documents a real, accepted limitation rather than pretending it's covered.

    ``_assert_safe_url`` only inspects IP *literals*; it never resolves DNS. A
    hostname that resolves to a private address (localtest.me, a rebinding
    service, or an attacker-controlled record pointing at 169.254.169.254) passes
    this check. Closing it means resolving the host and validating every returned
    address, then pinning the connection to a validated address to defeat
    rebinding. If that lands, invert this test.
    """
    _assert_safe_url("http://localtest.me/")  # resolves to 127.0.0.1 in practice
    _assert_safe_url("http://db/")            # the Compose service name
