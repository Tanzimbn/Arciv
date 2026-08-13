"""URL-pattern fallback classification.

This is the "AI is optional" guarantee from CLAUDE.md: with no provider
configured, a saved link must still land in a sensible queue. The subdomain
matching is the part that regresses — a naive `in hostname` check would route
`github.com.phish.example` to try-later.
"""
import pytest

from api.utils.heuristics import classify_by_url


@pytest.mark.parametrize(
    "url,content_type,queue",
    [
        ("https://www.youtube.com/watch?v=abc", "video", "watch-later"),
        ("https://youtu.be/abc", "video", "watch-later"),
        ("https://vimeo.com/12345", "video", "watch-later"),
        ("https://www.loom.com/share/x", "video", "watch-later"),
        ("https://github.com/psf/requests", "tool", "try-later"),
        ("https://gitlab.com/x/y", "tool", "try-later"),
        ("https://www.npmjs.com/package/react", "tool", "try-later"),
        ("https://pypi.org/project/fastapi/", "tool", "try-later"),
        ("https://arxiv.org/abs/2401.00001", "research-paper", "read-later"),
        ("https://scholar.google.com/citations?user=x", "research-paper", "read-later"),
        ("https://someone.substack.com/p/post", "newsletter", "read-later"),
        # Default
        ("https://example.com/blog/post", "article", "read-later"),
        ("https://news.ycombinator.com/item?id=1", "article", "read-later"),
    ],
)
def test_known_domains_route_to_the_documented_queue(url, content_type, queue):
    assert classify_by_url(url) == (content_type, queue)


@pytest.mark.parametrize(
    "url",
    [
        "https://github.com.evil.example/psf/requests",
        "https://notgithub.com/x",
        "https://myyoutube.com/watch",
    ],
)
def test_lookalike_hostnames_do_not_match(url):
    """Matching is exact-host or true-subdomain, never substring."""
    assert classify_by_url(url) == ("article", "read-later")


def test_www_prefix_is_ignored():
    assert classify_by_url("https://www.github.com/x") == classify_by_url("https://github.com/x")


@pytest.mark.parametrize("url", ["not-a-url", "", "https://", "mailto:a@b.com"])
def test_unparseable_urls_fall_back_instead_of_raising(url):
    """This runs inside the link-create request path, so it must never throw."""
    assert classify_by_url(url) == ("article", "read-later")
