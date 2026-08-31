from pydantic import BaseModel, Field, field_validator

# A header value cannot carry control characters — CRLF there is request
# splitting. Rejected at the write boundary so a bad key never reaches the DB;
# agent.providers.ollama checks again as a backstop for rows that predate this.
_CONTROL_CHARS = frozenset(chr(c) for c in list(range(0x20)) + [0x7F])


def _reject_control_chars(v: str | None) -> str | None:
    if v and _CONTROL_CHARS.intersection(v):
        raise ValueError("must not contain control characters")
    return v


class SettingsResponse(BaseModel):
    username: str | None
    ai_provider: str
    # None = the provider's own default model (see AIProvider.DEFAULT_MODEL).
    ai_model: str | None
    ai_api_key_masked: str | None
    feed_notify_telegram: bool
    feed_notify_inapp: bool
    telegram_enabled: bool
    shared_ai_available: bool

    model_config = {"from_attributes": True}


class SettingsUpdate(BaseModel):
    username: str | None = None
    ai_provider: str | None = None
    # Any bounded non-empty string, deliberately not an enum: the whole point is
    # that a provider can retire a model without a redeploy, and a closed list
    # would lock the user out of the one setting that fixes their outage. "" means
    # "back to the provider default".
    ai_model: str | None = Field(default=None, max_length=100)
    # "" clears the stored credential (Disconnect). Capped at the same 500 as
    # AIModelsRequest.api_key — no provider key comes near that, and an
    # unbounded column is a free write amplifier.
    ai_api_key: str | None = Field(default=None, max_length=500)
    feed_notify_telegram: bool | None = None
    feed_notify_inapp: bool | None = None

    _no_ctrl = field_validator("ai_api_key")(_reject_control_chars)


class AITestResult(BaseModel):
    success: bool
    message: str
    provider: str


class UsageQuota(BaseModel):
    used: int
    limit: int  # 0 = unlimited


class UsageResponse(BaseModel):
    links: UsageQuota
    feeds: UsageQuota
    storage: UsageQuota  # bytes


class AIModelsRequest(BaseModel):
    """Optional overrides for a model listing.

    These let the UI validate a key the user has *typed but not saved*, so
    "paste key → is it good? → here are your models" is one request. For four of
    the five providers the listing itself is the check, because the catalogue
    sits behind the key — no completion, no tokens billed. Ollama Cloud's
    catalogue is public, so its provider probes an auth-gated endpoint first
    (``OllamaProvider._check_credentials``); the guarantee this endpoint makes to
    the UI is the same either way. An empty body falls back to the stored
    provider and key.

    Nothing here is persisted. Saving is still an explicit PATCH.
    """

    provider: str | None = None
    api_key: str | None = Field(default=None, min_length=1, max_length=500)

    _no_ctrl = field_validator("api_key")(_reject_control_chars)


class AIModelsResponse(BaseModel):
    provider: str
    models: list[str]
    default: str  # used when ai_model is None
    cached: bool
    # Which credential answered: the body's key, the stored one, or the
    # instance's shared Gemini key. The UI says so, because "your key works" and
    # "somebody else's key works" are very different answers.
    key_source: str
