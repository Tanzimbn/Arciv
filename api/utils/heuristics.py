from urllib.parse import urlparse

RULES = [
    ({"youtube.com", "youtu.be", "vimeo.com", "loom.com"}, "video", "watch-later"),
    ({"github.com", "gitlab.com", "npmjs.com", "pypi.org"}, "tool", "try-later"),
    ({"arxiv.org", "scholar.google.com"}, "research-paper", "read-later"),
    ({"substack.com"}, "newsletter", "read-later"),
]


def classify_by_url(url: str) -> tuple[str, str]:
    """Returns (content_type, queue) from URL pattern. No LLM calls."""
    hostname = (urlparse(url).hostname or "").removeprefix("www.")
    for domains, content_type, queue in RULES:
        if any(hostname == d or hostname.endswith("." + d) for d in domains):
            return content_type, queue
    return "article", "read-later"
