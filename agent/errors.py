"""The AI-provider error taxonomy, and one classifier shared by all providers.

Split into *permanent* and *transient*, because `worker/ai_classify.py` treats
them completely differently: a transient failure goes on the backoff ladder, a
permanent one is terminal and notifies the user. Getting this wrong is not
cosmetic — a permanent error on the ladder burns four attempts over ~72 minutes
and then gets resurrected hourly by ``sweep_failed_links``, so the link never
settles anywhere the UI can report it.

| Kind | Exception | Retry? |
|---|---|---|
| bad/missing credentials | ``AuthError`` | no — user must fix the key |
| unknown/retired model | ``ModelError`` | no — user must pick another model |
| rate limit / quota | ``QuotaError`` | yes |
| malformed LLM output | ``ParseError`` | no — falls back to URL heuristics |
| anything else | re-raised as-is | yes |
"""
import ast
import json
import re
from typing import NoReturn


class ParseError(Exception):
    """The model replied, but not with the JSON we asked for."""


class AuthError(Exception):
    """The credentials were rejected. Permanent until the user changes the key."""


class QuotaError(Exception):
    """Rate limited or out of quota. Worth retrying later."""


class ModelError(Exception):
    """The configured model is unknown, decommissioned, or not permitted.

    Permanent: the identical request cannot start working, so retrying only
    delays telling the user. Raised for the provider's own 400/404 — see
    ``raise_mapped``.
    """


_AUTH_STATUSES = frozenset({401, 403})
_MODEL_STATUSES = frozenset({400, 404})

# Checked before the status code, because Gemini reports a rejected key as a
# 400 InvalidArgument — which would otherwise look exactly like a bad model.
_AUTH_MARKERS = (
    "api_key_invalid",
    "invalid_api_key",
    "invalid x-api-key",
    "authentication",
    "unauthorized",
    "permission_denied",
)
_QUOTA_MARKERS = ("rate_limit", "rate limit", "quota", "overloaded", "resource_exhausted")


def http_status_of(e: BaseException) -> int | None:
    """Pull the HTTP status out of whichever SDK raised.

    Three shapes cover all five providers:

    * ``groq`` / ``openai`` / ``anthropic`` — all generated from the same
      codegen, so an ``APIStatusError`` instance carries ``status_code``.
    * ``google.api_core.exceptions`` (Gemini) — ``code`` is the HTTP status.
    * ``httpx.HTTPStatusError`` (Ollama) — on the response.
    """
    status = getattr(e, "status_code", None)
    if isinstance(status, int):
        return status

    code = getattr(e, "code", None)
    if isinstance(code, int):
        return code

    response = getattr(e, "response", None)
    status = getattr(response, "status_code", None)
    if isinstance(status, int):
        return status

    return None


def raise_mapped(e: Exception) -> NoReturn:
    """Re-raise ``e`` as the matching taxonomy member, or unchanged.

    Classification is by status code rather than by message text, so it does not
    rot when a provider rewords its errors. ``ParseError`` passes through
    untouched — it is ours, not the provider's.

    400 and 404 both mean the request itself was wrong, and the model name is
    the only part of it the user controls, so both map to ``ModelError``. That
    covers Groq's ``model_decommissioned``, OpenAI's ``model_not_found``,
    Anthropic's ``not_found_error``, Gemini's ``NotFound``, and Ollama's 404 for
    a model that was never pulled. The provider's own wording is preserved so
    the user reads the real reason.
    """
    if isinstance(e, (ParseError, AuthError, QuotaError, ModelError)):
        raise e

    message = str(e)
    lowered = message.lower()
    status = http_status_of(e)

    if any(marker in lowered for marker in _AUTH_MARKERS) or status in _AUTH_STATUSES:
        raise AuthError(message) from e

    if status == 429 or any(marker in lowered for marker in _QUOTA_MARKERS):
        raise QuotaError(message) from e

    if status in _MODEL_STATUSES:
        raise ModelError(message) from e

    raise e


# "Error code: 401 - " / "429 Too Many Requests: " and similar prefixes the SDKs
# glue on before the payload. Stripped because the status code is already carried
# by the HTTP status of our own response.
_STATUS_PREFIX = re.compile(r"^\s*(?:error\s*code\s*:?\s*)?\d{3}\s*[-:]?\s*", re.I)
_BRACE = re.compile(r"[{\[]")
# Last resort when neither literal_eval nor json.loads can parse the payload.
_MESSAGE_FIELD = re.compile(r"""['"]message['"]\s*:\s*['"](.+?)['"]""", re.S)


def _dig_message(payload: object) -> str | None:
    """Find the human sentence inside a decoded provider error body.

    Providers nest it differently — Groq/OpenAI use ``{"error": {"message": …}}``,
    Ollama a bare ``{"error": "…"}`` — so walk rather than assume a shape.
    """
    if isinstance(payload, str):
        return payload.strip() or None
    if isinstance(payload, dict):
        for key in ("message", "error", "detail", "error_message"):
            if key in payload:
                found = _dig_message(payload[key])
                if found:
                    return found
    if isinstance(payload, list):
        for item in payload:
            found = _dig_message(item)
            if found:
                return found
    return None


def human_message(e: BaseException | str) -> str:
    """The provider's own sentence, without its wire format.

    Every SDK stringifies to something like::

        Error code: 401 - {'error': {'message': 'Invalid API Key',
                           'type': 'invalid_request_error',
                           'code': 'expired_api_key'}}

    Showing that to a user is showing them a debugging artifact: the sentence they
    need is four words of it. This returns ``"Invalid API Key (expired_api_key)"``
    — the message, plus the machine code in parentheses when there is one, because
    ``expired_api_key`` and ``invalid_api_key`` mean different things to whoever
    has to fix it.

    Only for user-facing text. ``ai_error`` on the row and the logs keep the raw
    string: when a message *cannot* be parsed, the raw text is the only clue left,
    and this falls back to it verbatim rather than inventing a friendlier lie.
    """
    raw = (e if isinstance(e, str) else str(e)).strip()
    if not raw:
        return "The provider returned an error with no message."

    body = _STATUS_PREFIX.sub("", raw, count=1).strip()

    match = _BRACE.search(body)
    payload = None
    if match:
        blob = body[match.start():]
        for parse in (ast.literal_eval, json.loads):
            try:
                payload = parse(blob)
                break
            except (ValueError, SyntaxError, TypeError, MemoryError, RecursionError):
                continue

    message = _dig_message(payload) if payload is not None else None
    if message is None:
        found = _MESSAGE_FIELD.search(body)
        message = found.group(1).strip() if found else None
    if message is None:
        # Nothing structured in there — the whole (de-prefixed) string is the
        # message. Common for Gemini and for plain httpx errors.
        message = body or raw

    code = None
    if isinstance(payload, dict):
        inner = payload.get("error") if isinstance(payload.get("error"), dict) else payload
        if isinstance(inner, dict):
            candidate = inner.get("code") or inner.get("type") or inner.get("status")
            if isinstance(candidate, str) and candidate and candidate.lower() not in message.lower():
                code = candidate

    message = message.rstrip(" .")
    return f"{message} ({code})" if code else message

