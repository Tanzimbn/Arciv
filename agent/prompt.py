import json

from agent.base import AIResult

# Re-exported so providers import prompts and the error taxonomy from one place.
from agent.errors import AuthError, ModelError, ParseError, QuotaError  # noqa: F401

CONTENT_TYPES = ["video", "article", "research-paper", "tool", "newsletter", "documentation", "other"]
QUEUES = ["watch-later", "read-later", "try-later"]

SYSTEM_PROMPT = (
    "You are an intelligent reading assistant for a personal bookmark manager. "
    "For each link, do two things: (1) classify it by type and destination queue, "
    "and (2) write a clear 2-3 sentence summary that tells the user what the content "
    "is about, why it matters, and what they will learn or gain from it — so they can "
    "decide at a glance whether to read it now. Write summaries in plain language, "
    "avoid jargon, and be specific rather than generic."
)

_SCHEMA = """{
  "content_type": "video|article|research-paper|tool|newsletter|documentation|other",
  "queue": "watch-later|read-later|try-later",
  "summary": "2-3 sentences: what it covers, why it matters, what the reader gains",
  "tags": ["tag1", "tag2", "tag3"]
}"""


def build_user_message(title: str, description: str, url: str) -> str:
    return f"""Classify this link and return ONLY valid JSON, no explanation:

URL: {url}
Title: {title or "Unknown"}
Description: {description or "No description available"}

Return JSON matching this schema exactly:
{_SCHEMA}

Tags: 2-5 lowercase hyphen-separated topic names ("react-native", "vector-search").
Name the subject, not the format. Reuse the obvious common name for a topic rather
than inventing a variant, so the same subject gets the same tag across links."""


def build_combined_prompt(title: str, description: str, url: str) -> str:
    return f"{SYSTEM_PROMPT}\n\n{build_user_message(title, description, url)}"


INSIGHTS_SYSTEM = (
    "You are a reading assistant that extracts key insights from articles. "
    "An insight is a specific, non-obvious fact, finding, or idea that the reader "
    "would find worth remembering — not common knowledge, not a summary. "
    "Each insight must be self-contained (understandable without reading the article), "
    "one sentence, direct and specific. Numbers, comparisons, and surprising findings "
    "make the best insights."
)

_INSIGHTS_SCHEMA = '["insight 1", "insight 2", "insight 3"]'


def build_insights_message(title: str, content: str, url: str) -> str:
    content_block = content.strip() if content else "No content available."
    return f"""Extract all key insights from this article. Return ONLY a JSON array of strings, no explanation.

URL: {url}
Title: {title or "Unknown"}

Content:
{content_block[:5000]}

Return JSON array matching this schema:
{_INSIGHTS_SCHEMA}"""


def parse_insights_response(text: str) -> list[str]:
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(lines[1:-1]).strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise ParseError(f"JSON decode failed: {e}") from e
    if not isinstance(data, list):
        raise ParseError("Expected a JSON array")
    return [str(item).strip() for item in data if str(item).strip()][:10]


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
