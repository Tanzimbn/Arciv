import json

from agent.base import AIResult

CONTENT_TYPES = ["video", "article", "research-paper", "tool", "newsletter", "documentation", "other"]
QUEUES = ["watch-later", "read-later", "try-later"]

SYSTEM_PROMPT = "You are a content classifier for a personal bookmark manager. Classify links accurately and concisely."

_SCHEMA = """{
  "content_type": "video|article|research-paper|tool|newsletter|documentation|other",
  "queue": "watch-later|read-later|try-later",
  "summary": "2-3 sentence plain-language summary",
  "tags": ["tag1", "tag2", "tag3"]
}"""


def build_user_message(title: str, description: str, url: str) -> str:
    return f"""Classify this link and return ONLY valid JSON, no explanation:

URL: {url}
Title: {title or "Unknown"}
Description: {description or "No description available"}

Return JSON matching this schema exactly:
{_SCHEMA}"""


def build_combined_prompt(title: str, description: str, url: str) -> str:
    return f"{SYSTEM_PROMPT}\n\n{build_user_message(title, description, url)}"


class ParseError(Exception):
    pass


class AuthError(Exception):
    pass


class QuotaError(Exception):
    pass


def parse_ai_response(text: str) -> AIResult:
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(lines[1:-1]).strip()

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise ParseError(f"JSON decode failed: {e}") from e

    ct = data.get("content_type", "article")
    if ct not in CONTENT_TYPES:
        ct = "article"

    q = data.get("queue", "read-later")
    if q not in QUEUES:
        q = "read-later"

    return AIResult(
        content_type=ct,
        queue=q,
        summary=data.get("summary", ""),
        tags=data.get("tags", [])[:5],
        raw_response=data,
    )
