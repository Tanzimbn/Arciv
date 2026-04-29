from dataclasses import dataclass
from urllib.parse import urljoin, urlparse

import feedparser
import httpx
from bs4 import BeautifulSoup

COMMON_PATHS = ["/feed", "/rss", "/rss.xml", "/atom.xml", "/feed.xml"]
FEED_CONTENT_TYPES = {"rss", "atom", "xml"}


@dataclass
class FeedInfo:
    feed_url: str
    title: str
    item_count: int
    favicon_url: str | None


async def discover_feed(url: str) -> FeedInfo | None:
    async with httpx.AsyncClient(follow_redirects=True, timeout=10.0) as client:
        # Try URL directly as a feed
        info = await _try_parse(client, url)
        if info:
            return info

        # Fetch as HTML, look for <link rel="alternate" type="...rss...">
        try:
            resp = await client.get(url)
            resp.raise_for_status()
            soup = BeautifulSoup(resp.text, "html.parser")
            for tag in soup.find_all("link", rel="alternate"):
                ctype = tag.get("type", "")
                if any(t in ctype for t in FEED_CONTENT_TYPES):
                    href = tag.get("href", "")
                    if href:
                        feed_url = urljoin(str(resp.url), href)
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
        resp = await client.get(url)
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
