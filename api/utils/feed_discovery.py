from dataclasses import dataclass
from urllib.parse import urljoin, urlparse

import feedparser
import httpx
from bs4 import BeautifulSoup

from api.config import settings
from api.utils.safe_fetch import parse_url, resolve_and_validate, safe_request

COMMON_PATHS = ["/feed", "/rss", "/rss.xml", "/atom.xml", "/feed.xml"]
FEED_CONTENT_TYPES = {"rss", "atom", "xml"}


@dataclass
class FeedInfo:
    feed_url: str
    title: str
    item_count: int
    favicon_url: str | None


async def discover_feed(url: str) -> FeedInfo | None:
    """Find a feed at ``url``, or return None.

    Discovery is the most fetch-happy endpoint in the app — up to seven outbound
    requests per call — so every one of them goes through ``safe_request``. The
    submitted URL is validated up front too, so an internal address is a clear
    rejection (``UnsafeURLError`` → 400) rather than an indistinguishable
    "no feed found".
    """
    try:
        await resolve_and_validate(parse_url(url))
    except httpx.RequestError:
        # Unresolvable or unreachable: no feed, not a policy violation.
        return None

    async with httpx.AsyncClient(
        follow_redirects=False,
        timeout=10.0,
        headers={"User-Agent": settings.USER_AGENT},
    ) as client:
        # Try URL directly as a feed
        info = await _try_parse(client, url)
        if info:
            return info

        # Fetch as HTML, look for <link rel="alternate" type="...rss...">
        try:
            resp, final_url = await safe_request("GET", url, client=client)
            resp.raise_for_status()
            soup = BeautifulSoup(resp.text, "html.parser")
            for tag in soup.find_all("link", rel="alternate"):
                ctype = tag.get("type", "")
                if any(t in ctype for t in FEED_CONTENT_TYPES):
                    href = tag.get("href", "")
                    if href:
                        # final_url, not resp.url: the connection is pinned to a
                        # validated IP, so resp.url is an address and a relative
                        # href would resolve against that instead of the host.
                        feed_url = urljoin(final_url, href)
                        info = await _try_parse(client, feed_url)
                        if info:
                            return info
        except Exception:
            pass

        # Try common paths on the base domain
        parsed = urlparse(url)
        base = f"{parsed.scheme}://{parsed.netloc}"
        for path in COMMON_PATHS:
            info = await _try_parse(client, base + path)
            if info:
                return info

    return None


async def _try_parse(client: httpx.AsyncClient, url: str) -> FeedInfo | None:
    try:
        resp, _final_url = await safe_request("GET", url, client=client)
        if resp.status_code != 200:
            return None
        parsed = feedparser.parse(resp.text)
        if not parsed.entries:
            return None
        title = parsed.feed.get("title") or url
        item_count = len(parsed.entries)
        image = parsed.feed.get("image") or {}
        favicon = parsed.feed.get("icon") or image.get("href")
        return FeedInfo(
            feed_url=url,
            title=title,
            item_count=item_count,
            favicon_url=favicon,
        )
    except Exception:
        return None


def parse_feed_content(content: str) -> feedparser.FeedParserDict:
    return feedparser.parse(content)


def entry_guid(entry) -> str:
    return entry.get("id") or entry.get("link") or ""
