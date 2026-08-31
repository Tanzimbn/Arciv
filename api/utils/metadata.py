from datetime import datetime
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

import httpx
from bs4 import BeautifulSoup

from api.config import settings
from api.utils.safe_fetch import UnsafeURLError, safe_request, safe_stream

TRACKING_PARAMS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
    "fbclid", "gclid", "ref",
}

HEADERS = {
    "User-Agent": settings.USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

def _unwrap_redirect_url(url: str) -> str:
    """Extract the real destination from JS-redirect wrapper URLs (e.g. google.com/url?q=...)."""
    parsed = urlparse(url)
    host = parsed.hostname or ""
    if (host == "google.com" or host.endswith(".google.com")) and parsed.path == "/url":
        q = parse_qs(parsed.query).get("q", [None])[0]
        if q and q.startswith("http"):
            return q
    return url


async def canonicalize_url(url: str) -> str:
    """Follows redirects, strips tracking params, and normalizes trailing slash for a URL.

    Raises ``UnsafeURLError`` (a ``ValueError``) for a URL that must not be
    fetched; callers turn that into a 400. A URL that is merely unreachable is
    kept as-is, so a dead or typo'd domain still saves.
    """
    url = _unwrap_redirect_url(url)
    try:
        # Streamed: only the destination matters here, so there's no reason to
        # pull the page body over the wire.
        async with safe_stream("GET", url, headers=HEADERS) as (_resp, logical_url):
            # The *logical* URL, not resp.url — the connection is pinned to a
            # validated IP, so resp.url is an address. Storing that would make
            # canonical URLs IP-based and break UNIQUE (user_id, canonical_url).
            final_url = logical_url
    except (httpx.TimeoutException, httpx.RequestError):
        final_url = url

    parsed = urlparse(final_url)
    params = parse_qs(parsed.query, keep_blank_values=True)
    cleaned = {k: v for k, v in params.items() if k not in TRACKING_PARAMS}
    query = urlencode(cleaned, doseq=True)
    path = parsed.path.rstrip("/") or "/"

    return urlunparse((
        parsed.scheme,
        parsed.netloc,
        path,
        parsed.params,
        query,
        "",
    ))


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.strip())
    except ValueError:
        return None


async def fetch_metadata(url: str) -> dict:
    """Fetch page and extract title, description, favicon, published_date."""
    result = {
        "title": None,
        "description": None,
        "favicon_url": None,
        "published_date": None,
        "fetch_status": "ok",
    }

    try:
        resp, final_url = await safe_request("GET", url, headers=HEADERS, timeout=10.0)
        resp.raise_for_status()
    except (
        UnsafeURLError,
        httpx.TimeoutException,
        httpx.HTTPStatusError,
        httpx.RequestError,
    ):
        result["fetch_status"] = "unreachable"
        return result

    soup = BeautifulSoup(resp.text, "html.parser")
    # Relative favicon hrefs resolve against where the page actually landed, and
    # final_url is the logical (hostname-based) URL, never the pinned address.
    parsed = urlparse(final_url)
    base = f"{parsed.scheme}://{parsed.netloc}"

    # Title: og:title > <title>
    og_title = soup.find("meta", property="og:title")
    if og_title and og_title.get("content"):
        result["title"] = og_title["content"].strip()
    elif soup.title and soup.title.string:
        result["title"] = soup.title.string.strip()

    # Description: og:description > meta[name=description]
    og_desc = soup.find("meta", property="og:description")
    if og_desc and og_desc.get("content"):
        result["description"] = og_desc["content"].strip()
    else:
        meta_desc = soup.find("meta", attrs={"name": "description"})
        if meta_desc and meta_desc.get("content"):
            result["description"] = meta_desc["content"].strip()

    # Published date: article:published_time > datePublished > date > <time datetime>
    pub = (
        soup.find("meta", property="article:published_time")
        or soup.find("meta", attrs={"name": "date"})
        or soup.find("meta", property="og:updated_time")
    )
    if pub and pub.get("content"):
        result["published_date"] = _parse_date(pub["content"])
    if not result["published_date"]:
        time_tag = soup.find("time", attrs={"datetime": True})
        if time_tag:
            result["published_date"] = _parse_date(time_tag["datetime"])

    # Favicon
    icon = soup.find("link", rel=lambda r: r and "icon" in r)
    if icon and icon.get("href"):
        href = icon["href"]
        if not href.startswith("http"):
            href = base + href
        if urlparse(href).scheme in ("http", "https"):
            result["favicon_url"] = href
    if not result["favicon_url"]:
        result["favicon_url"] = f"{base}/favicon.ico"

    return result


async def fetch_article_text(url: str, max_chars: int = 6000) -> str:
    """Fetch readable article text for AI processing. Returns empty string on failure."""
    try:
        resp, _final_url = await safe_request("GET", url, headers=HEADERS, timeout=12.0)
        resp.raise_for_status()
    except (
        UnsafeURLError,
        httpx.TimeoutException,
        httpx.HTTPStatusError,
        httpx.RequestError,
    ):
        return ""

    soup = BeautifulSoup(resp.text, "html.parser")

    # Remove noise elements
    for tag in soup(["script", "style", "nav", "header", "footer", "aside", "form", "iframe"]):
        tag.decompose()

    # Prefer semantic article containers
    body = (
        soup.find("article")
        or soup.find("main")
        or soup.find(id=lambda i: i and "content" in i.lower())
        or soup.find(class_=lambda c: c and "content" in " ".join(c).lower())
        or soup.body
    )
    if body is None:
        return ""

    text = " ".join(body.get_text(separator=" ").split())
    return text[:max_chars]
