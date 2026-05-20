from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from agent.registry import VALID_PROVIDERS, make_provider
from api.config import settings
from api.database import get_db
from api.middleware.auth import get_current_user
from api.models.user import User
from api.schemas.settings import AITestResult, SettingsResponse, SettingsUpdate
from api.utils.encryption import decrypt_value, encrypt_value, mask_api_key

router = APIRouter()


def _build_response(user: User) -> SettingsResponse:
    masked = None
    if user.ai_api_key_enc:
        try:
            raw = decrypt_value(user.ai_api_key_enc, settings.ENCRYPTION_KEY)
            masked = mask_api_key(raw)
        except Exception:
            masked = "****"
    return SettingsResponse(
        ai_provider=user.ai_provider,
        ai_api_key_masked=masked,
        feed_notify_telegram=user.feed_notify_telegram,
        feed_notify_inapp=user.feed_notify_inapp,
    )


@router.get("/", response_model=SettingsResponse)
async def get_settings(current_user: User = Depends(get_current_user)):
    return _build_response(current_user)


@router.patch("/", response_model=SettingsResponse)
async def update_settings(
    body: SettingsUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.ai_provider is not None:
        if body.ai_provider not in VALID_PROVIDERS:
            raise HTTPException(status_code=400, detail=f"Invalid provider. Must be one of: {sorted(VALID_PROVIDERS)}")
        current_user.ai_provider = body.ai_provider
    if body.ai_api_key is not None:
        if body.ai_api_key == "":
            current_user.ai_api_key_enc = None
        else:
            current_user.ai_api_key_enc = encrypt_value(body.ai_api_key, settings.ENCRYPTION_KEY)
    if body.feed_notify_telegram is not None:
        current_user.feed_notify_telegram = body.feed_notify_telegram
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
            api_key = decrypt_value(current_user.ai_api_key_enc, settings.ENCRYPTION_KEY)
        except Exception:
            return AITestResult(success=False, message="Failed to decrypt API key.", provider=provider_name)
    elif settings.SHARED_GEMINI_KEY:
        api_key = settings.SHARED_GEMINI_KEY
        provider_name = "gemini"
        using_shared_fallback = True
    else:
        return AITestResult(success=False, message="No API key configured.", provider=provider_name)

    try:
        provider = make_provider(provider_name, api_key)
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
        return AITestResult(success=False, message=str(e), provider=provider_name)
