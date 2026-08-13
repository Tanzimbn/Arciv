"""URL canonicalisation — the input to the `UNIQUE (user_id, canonical_url)` dedup.

If canonicalisation changes shape, previously-deduped links stop deduping (and
already-saved rows can never be matched again), so the exact output format is
pinned here. Network is faked: `canonicalize_url` opens a real httpx client, so
the tests substitute the streaming call rather than reaching out.
"""
from urllib.parse import urlparse

import httpx
import pytest

from api.utils import metadata as md


@pytest.fixture
def resolves_to(monkeypatch):
    """Make `canonicalize_url` behave as if the server redirected to `final`."""

    def _install(final: str | None = None, *, raises: Exception | None = None):
        class _Resp:
            def __init__(self, url):
                self.url = url

        class _StreamCM:
            def __init__(self, url):
                self._url = url

            async def __aenter__(self):
                if raises is not None:
                    raise raises
                return _Resp(self._url)

            async def __aexit__(self, *exc):
                return False

        class _Client:
            def __init__(self, *a, **kw):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            def stream(self, method, url, **kw):
                return _StreamCM(final if final is not None else url)

        monkeypatch.setattr(md.httpx, "AsyncClient", _Client)

    return _install


async def test_tracking_params_are_stripped(resolves_to):
    resolves_to()
    out = await md.canonicalize_url(
        "https://example.com/post?utm_source=x&utm_medium=y&fbclid=z&gclid=w&ref=hn&id=42"
    )
    assert out == "https://example.com/post?id=42"


async def test_non_tracking_params_survive_in_order(resolves_to):
    resolves_to()
    out = await md.canonicalize_url("https://example.com/s?q=rust&page=2&utm_campaign=c")
    assert out == "https://example.com/s?q=rust&page=2"


async def test_trailing_slash_normalised_but_root_kept(resolves_to):
    resolves_to()
    assert await md.canonicalize_url("https://example.com/a/b/") == "https://example.com/a/b"
    assert await md.canonicalize_url("https://example.com/") == "https://example.com/"
    assert await md.canonicalize_url("https://example.com") == "https://example.com/"


async def test_fragment_is_dropped(resolves_to):
    resolves_to()
    assert await md.canonicalize_url("https://example.com/a#section") == "https://example.com/a"


async def test_redirects_are_followed_to_the_final_url(resolves_to):
    resolves_to("https://example.com/real-article?utm_source=t")
    out = await md.canonicalize_url("https://t.co/shortcode")
    assert out == "https://example.com/real-article"


async def test_google_redirect_wrapper_is_unwrapped(resolves_to):
    resolves_to()
    out = await md.canonicalize_url("https://www.google.com/url?q=https://example.com/target/")
    assert out == "https://example.com/target"


async def test_unreachable_host_falls_back_to_the_submitted_url(resolves_to):
    """A dead link must still be saveable — canonicalisation degrades, not fails."""
    resolves_to(raises=httpx.ConnectError("no route"))
    out = await md.canonicalize_url("https://down.example.com/x/?utm_source=n")
    assert out == "https://down.example.com/x"


async def test_timeout_falls_back_to_the_submitted_url(resolves_to):
    resolves_to(raises=httpx.ReadTimeout("slow"))
    assert await md.canonicalize_url("https://slow.example.com/a") == "https://slow.example.com/a"


async def test_private_target_is_refused_before_any_request(resolves_to):
    resolves_to()
    with pytest.raises(ValueError, match="private/internal"):
        await md.canonicalize_url("http://169.254.169.254/latest/meta-data/")


async def test_google_wrapper_cannot_smuggle_an_internal_target(resolves_to):
    """The unwrapped destination is re-validated — otherwise the wrapper is an
    SSRF bypass: a public google.com host hiding an internal target."""
    resolves_to()
    with pytest.raises(ValueError, match="private/internal"):
        await md.canonicalize_url("https://www.google.com/url?q=http://127.0.0.1:5432/")


async def test_offline_helper_matches_the_real_thing(resolves_to):
    """`canonicalize_offline` in conftest stands in for this function in the
    integration tests; if the two drift, dedup tests stop testing dedup."""
    from conftest import canonicalize_offline

    resolves_to()
    for url in (
        "https://example.com/post?utm_source=x&id=42",
        "https://example.com/a/b/",
        "https://example.com/",
        "https://example.com/a#frag",
    ):
        assert await md.canonicalize_url(url) == canonicalize_offline(url), url
        assert urlparse(canonicalize_offline(url)).fragment == ""
