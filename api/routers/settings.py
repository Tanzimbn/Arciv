import hashlib
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from agent.errors import AuthError, human_message
from agent.registry import VALID_PROVIDERS, default_model_for, make_provider
from api.config import settings
from api.database import get_db
from api.middleware.auth import get_current_user
from api.models.feed import Feed
from api.models.link import Link
from api.models.user import User
from api.schemas.settings import (
    AIModelsRequest,
    AIModelsResponse,
    AITestResult,
    SettingsResponse,
    SettingsUpdate,
    UsageQuota,
    UsageResponse,
)
from api.utils.encryption import decrypt_secret, encrypt_secret, mask_api_key
from api.utils.ratelimit import enforce_user_rate_limit
from api.utils.username import validate_username

router = APIRouter()


def _build_response(user: User) -> SettingsResponse:
    masked = None
    if user.ai_api_key_enc:
        try:
            masked = mask_api_key(decrypt_secret(user.ai_api_key_enc))
        except Exception:
            masked = "****"
    return SettingsResponse(
        username=user.username,
        ai_provider=user.ai_provider,
        ai_model=user.ai_model,
        ai_api_key_masked=masked,
        feed_notify_inapp=user.feed_notify_inapp,
        shared_ai_available=bool(settings.SHARED_GEMINI_KEY),
    )


@router.get("", response_model=SettingsResponse)
async def get_settings(current_user: User = Depends(get_current_user)):
    return _build_response(current_user)


@router.get("/usage", response_model=UsageResponse)
async def get_usage(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Current consumption vs. per-account caps. `limit == 0` means unlimited
    (self-host default), which the UI renders as no meter."""
    link_count = await db.scalar(
        select(func.count()).select_from(Link).where(Link.user_id == current_user.id)
    )
    feed_count = await db.scalar(
        select(func.count()).select_from(Feed).where(Feed.user_id == current_user.id)
    )
    return UsageResponse(
        links=UsageQuota(used=link_count or 0, limit=settings.MAX_LINKS_PER_USER),
        feeds=UsageQuota(used=feed_count or 0, limit=settings.MAX_FEEDS_PER_USER),
        storage=UsageQuota(
            used=current_user.storage_bytes,
            limit=settings.MAX_STORAGE_BYTES_PER_USER,
        ),
    )


@router.patch("", response_model=SettingsResponse)
async def update_settings(
    body: SettingsUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.username is not None:
        if not validate_username(body.username):
            raise HTTPException(
                status_code=422,
                detail="Invalid username. Use 3-30 chars: lowercase letters, numbers, underscores only.",
            )
        current_user.username = body.username
        try:
            await db.flush()
        except IntegrityError:
            await db.rollback()
            raise HTTPException(status_code=409, detail="Username already taken.")
    if body.ai_provider is not None:
        if body.ai_provider not in VALID_PROVIDERS:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid provider. Must be one of: {sorted(VALID_PROVIDERS)}",
            )
        # Switching provider invalidates the model, unless the same PATCH supplies
        # a new one. Keeping it would carry e.g. a Groq model id over to OpenAI and
        # 404 every classify — the same outage, self-inflicted.
        if body.ai_provider != current_user.ai_provider and body.ai_model is None:
            current_user.ai_model = None
        current_user.ai_provider = body.ai_provider
    if body.ai_model is not None:
        model = body.ai_model.strip()
        current_user.ai_model = model or None
    if body.ai_api_key is not None:
        if body.ai_api_key == "":
            current_user.ai_api_key_enc = None
        else:
            current_user.ai_api_key_enc = encrypt_secret(body.ai_api_key)
    if body.feed_notify_inapp is not None:
        current_user.feed_notify_inapp = body.feed_notify_inapp

    await db.commit()
    await db.refresh(current_user)
    return _build_response(current_user)


@router.post("/ai/test", response_model=AITestResult)
async def test_ai_connection(current_user: User = Depends(get_current_user)):
    provider_name = current_user.ai_provider

    using_shared_fallback = False
    if current_user.ai_api_key_enc:
        try:
            api_key = decrypt_secret(current_user.ai_api_key_enc)
        except Exception:
            return AITestResult(success=False, message="Failed to decrypt API key.", provider=provider_name)
    elif settings.SHARED_GEMINI_KEY:
        api_key = settings.SHARED_GEMINI_KEY
        provider_name = "gemini"
        using_shared_fallback = True
    else:
        return AITestResult(success=False, message="No API key configured.", provider=provider_name)

    try:
        model = None if using_shared_fallback else current_user.ai_model
        provider = make_provider(provider_name, api_key, model)
        result = await provider.classify_and_summarise(
            title="OpenAI",
            content="OpenAI is an AI research company.",
            url="https://openai.com",
        )
        if result:
            msg = "Connection successful (via shared Gemini key)." if using_shared_fallback else "Connection successful."
            return AITestResult(success=True, message=msg, provider=provider_name)
        return AITestResult(success=False, message="Provider returned no result.", provider=provider_name)
    except Exception as e:
        return AITestResult(success=False, message=human_message(e), provider=provider_name)


def _resolve_ai_credentials(user: User) -> tuple[str, str, str | None]:
    """(provider_name, api_key, model) for an outbound provider call.

    Same resolution as ``/ai/test``: the user's own key, else the instance's
    shared Gemini key. The shared key is Gemini's, so a user's model choice may
    not ride along with it.
    """
    if user.ai_api_key_enc:
        try:
            return user.ai_provider, decrypt_secret(user.ai_api_key_enc), user.ai_model
        except Exception:
            raise HTTPException(status_code=422, detail="Failed to decrypt API key.")
    if settings.SHARED_GEMINI_KEY:
        return "gemini", settings.SHARED_GEMINI_KEY, None
    raise HTTPException(status_code=422, detail="No API key configured.")


@router.post("/ai/models", response_model=AIModelsResponse)
async def list_ai_models(
    request: Request,
    body: AIModelsRequest | None = None,
    current_user: User = Depends(get_current_user),
):
    """The model ids a key can actually use, asked of the provider itself.

    Live rather than a curated list, because a hardcoded list is the bug this
    endpoint exists to fix: providers retire models on their own schedule. Cached
    per (provider, key) so opening Settings doesn't bill a request every time.

    POST, not GET, for one reason: the body may carry an API key the user has
    typed but not saved, and a secret must never ride in a URL (query strings
    land in access logs, proxies and browser history). Nothing is persisted.

    A rejected key is a **400**, not a 502 — the caller's input is wrong, not the
    provider — so the UI can say "this key was rejected" instead of "upstream
    error" and the user knows which field to fix. Either way `detail` is the
    provider's sentence and nothing else (`human_message`): the status says whose
    fault it is, so repeating that in the text just buries the sentence the user
    actually has to read.
    """
    redis = getattr(request.app.state, "arq_pool", None)
    await enforce_user_rate_limit(
        redis,
        scope="ai_models",
        user_id=current_user.id,
        limit=settings.AI_MODELS_PER_MINUTE,
        window=60,
        detail="Too many model-list requests. Try again in a minute.",
    )

    body = body or AIModelsRequest()
    if body.api_key:
        provider_name = body.provider or current_user.ai_provider
        if provider_name not in VALID_PROVIDERS:
            raise HTTPException(status_code=422, detail=f"Unknown provider '{provider_name}'.")
        api_key = body.api_key.strip()
        if not api_key:
            raise HTTPException(status_code=422, detail="API key is empty.")
        # The stored model is irrelevant to a listing, and pairing it with a key
        # for a different provider would be nonsense.
        model, key_source = None, "typed"
    else:
        provider_name, api_key, model = _resolve_ai_credentials(current_user)
        key_source = "saved" if current_user.ai_api_key_enc else "shared"

    default = default_model_for(provider_name)

    # Key on a hash of the key, not the user: two accounts with the same key
    # share the same answer, and a rotated key must not read a stale list.
    cache_key = f"ai_models:{provider_name}:{hashlib.sha256(api_key.encode()).hexdigest()[:16]}"
    # TTL 0 disables the cache, matching every other limit in config.py. It has
    # to short-circuit both sides: Redis rejects `SET ... EX 0` outright, so
    # writing it would 500 the endpoint instead of skipping the cache.
    cache_enabled = redis is not None and settings.AI_MODELS_CACHE_TTL > 0
    if cache_enabled:
        cached = await redis.get(cache_key)
        if cached:
            try:
                return AIModelsResponse(
                    provider=provider_name,
                    models=json.loads(cached),
                    default=default,
                    cached=True,
                    key_source=key_source,
                )
            except (ValueError, TypeError):
                pass  # unreadable cache entry — fall through and refetch

    try:
        models = await make_provider(provider_name, api_key, model).list_models()
    except AuthError as e:
        # The key itself was refused (401/403, or Gemini's 400 API_KEY_INVALID).
        # The provider's own words survive — "expired_api_key" tells the user
        # something "authentication failed" does not — but not its wire format.
        raise HTTPException(status_code=400, detail=human_message(e))
    except Exception as e:
        # Anything else is upstream's problem, not the key's: outage, timeout,
        # a 5xx. Reported with the provider's message so it isn't guesswork.
        raise HTTPException(status_code=502, detail=human_message(e))

    if cache_enabled:
        await redis.set(cache_key, json.dumps(models), ex=settings.AI_MODELS_CACHE_TTL)

    return AIModelsResponse(
        provider=provider_name, models=models, default=default, cached=False,
        key_source=key_source,
    )
