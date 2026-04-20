from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

import httpx
from bs4 import BeautifulSoup

TRACKING_PARAMS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
    "fbclid", "gclid", "ref",
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; Arciv/1.0)",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


async def canonicalize_url(url: str) -> str:
    """Follow redirects, strip tracking params, normalize trailing slash."""
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=10.0) as client:
            resp = await client.head(url, headers=HEADERS)
            final_url = str(resp.url)
    except Exception:
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


async def fetch_metadata(url: str) -> dict:
    """Fetch page and extract title, description, favicon."""
    result = {
        "title": None,
        "description": None,
        "favicon_url": None,
        "fetch_status": "ok",
    }

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=10.0) as client:
            resp = await client.get(url, headers=HEADERS)
            resp.raise_for_status()
    except (httpx.TimeoutException, httpx.HTTPStatusError, httpx.RequestError):
        result["fetch_status"] = "unreachable"
        return result

    soup = BeautifulSoup(resp.text, "html.parser")
    parsed = urlparse(url)
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

    # Favicon
    icon = soup.find("link", rel=lambda r: r and "icon" in r)
    if icon and icon.get("href"):
        href = icon["href"]
        result["favicon_url"] = href if href.startswith("http") else base + href
    else:
        result["favicon_url"] = f"{base}/favicon.ico"

    return result
