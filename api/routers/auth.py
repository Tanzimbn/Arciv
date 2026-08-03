import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.database import get_db
from api.middleware.auth import create_access_token, get_current_user
from api.models.user import User
from api.schemas.auth import (
    ForgotPasswordRequest,
    LoginRequest,
    LogoutRequest,
    MessageResponse,
    RefreshRequest,
    RegisterRequest,
    ResendVerificationRequest,
    ResetPasswordRequest,
    TokenResponse,
    UserResponse,
    VerifyEmailRequest,
)
from slowapi.util import get_remote_address

from api.utils.disposable_email import is_disposable
from api.utils.ratelimit import limiter
from api.utils.security import hash_password, verify_password
from api.utils.turnstile import verify_turnstile
from api.utils.tokens import (
    consume_email_token,
    create_refresh_token,
    get_valid_refresh_token,
    issue_email_token,
    revoke_all_for_user,
    revoke_refresh_token,
)
from api.utils.username import generate_username

router = APIRouter()

# Generic responses — never reveal whether an email exists (no user enumeration).
_GENERIC_EMAIL_SENT = MessageResponse(
    message="If an account exists for that address, an email is on its way."
)


def _access_expires_in() -> int:
    return settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60


async def _enqueue_email(request: Request, to: str, subject: str, template: str, ctx: dict) -> None:
    pool = getattr(request.app.state, "arq_pool", None)
    if pool is not None:
        await pool.enqueue_job("send_email_job", to, subject, template, ctx)


async def _send_verification(request: Request, user: User) -> None:
    raw = await issue_email_token("verify", user.id, settings.VERIFY_TOKEN_TTL_HOURS)
    verify_url = f"{settings.APP_BASE_URL.rstrip('/')}/verify-email?token={raw}"
    await _enqueue_email(
        request, user.email, "Confirm your Arciv email", "verify_email",
        {"verify_url": verify_url, "ttl_hours": settings.VERIFY_TOKEN_TTL_HOURS},
    )


async def _issue_token_pair(db: AsyncSession, user: User, request: Request) -> TokenResponse:
    refresh = await create_refresh_token(
        db, user.id,
        user_agent=request.headers.get("user-agent"),
        ip=request.client.host if request.client else None,
    )
    return TokenResponse(
        access_token=create_access_token(user.id),
        refresh_token=refresh,
        expires_in=_access_expires_in(),
    )


@router.post("/register", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit(lambda: settings.AUTH_REGISTER_RATE_LIMIT)
async def register(body: RegisterRequest, request: Request, db: AsyncSession = Depends(get_db)):
    if not await verify_turnstile(body.captcha_token, get_remote_address(request)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Captcha verification failed. Please try again.",
        )

    if settings.BLOCK_DISPOSABLE_EMAILS and is_disposable(body.email):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Please use a permanent email address.",
        )

    result = await db.execute(select(User).where(User.email == body.email))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Email already registered"
        )

    # Global daily signup ceiling — a backstop against mass automated signup
    # that rotating IPs slip past the per-IP "3/hour" limit above.
    if settings.SIGNUPS_PER_DAY_GLOBAL > 0:
        pool = getattr(request.app.state, "arq_pool", None)
        if pool is not None:
            day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            signup_key = f"signups:{day}"
            count = await pool.incr(signup_key)
            if count == 1:
                await pool.expire(signup_key, 86400)
            if count > settings.SIGNUPS_PER_DAY_GLOBAL:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Sign-ups are temporarily closed. Please try again tomorrow.",
                )

    # Generate unique username, retry up to 5 times on collision
    username = None
    for _ in range(5):
        candidate = generate_username()
        existing = await db.execute(select(User).where(User.username == candidate))
        if not existing.scalar_one_or_none():
            username = candidate
            break

    user = User(email=body.email, password_hash=hash_password(body.password), username=username)
    db.add(user)
    await db.commit()
    await db.refresh(user)

    await _send_verification(request, user)
    return MessageResponse(
        message="Account created. Check your email to verify your address before logging in."
    )


@router.post("/verify-email", response_model=MessageResponse)
@limiter.limit(lambda: settings.AUTH_VERIFY_EMAIL_RATE_LIMIT)
async def verify_email(body: VerifyEmailRequest, request: Request, db: AsyncSession = Depends(get_db)):
    user_id = await consume_email_token("verify", body.token)
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification link",
        )

    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid link")

    if not user.email_verified:
        user.email_verified = True
        user.email_verified_at = datetime.now(timezone.utc)
        await db.commit()

    return MessageResponse(message="Email verified. You can now log in.")


@router.post("/resend-verification", response_model=MessageResponse)
@limiter.limit(lambda: settings.AUTH_RESEND_VERIFICATION_RATE_LIMIT)
async def resend_verification(
    body: ResendVerificationRequest, request: Request, db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if user and not user.email_verified:
        await _send_verification(request, user)
    return _GENERIC_EMAIL_SENT


@router.post("/login", response_model=TokenResponse)
@limiter.limit(lambda: settings.AUTH_LOGIN_RATE_LIMIT)
async def login(body: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password"
        )

    if not user.email_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Email not verified. Check your inbox or request a new link.",
        )

    return await _issue_token_pair(db, user, request)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, request: Request, db: AsyncSession = Depends(get_db)):
    tok = await get_valid_refresh_token(db, body.refresh_token)
    if tok is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token"
        )

    # Rotation: revoke the presented token, issue a fresh pair.
    await revoke_refresh_token(db, body.refresh_token)
    result = await db.execute(select(User).where(User.id == tok.user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    return await _issue_token_pair(db, user, request)


@router.post("/logout", response_model=MessageResponse)
async def logout(body: LogoutRequest, db: AsyncSession = Depends(get_db)):
    await revoke_refresh_token(db, body.refresh_token)
    return MessageResponse(message="Logged out.")


@router.post("/forgot-password", response_model=MessageResponse)
@limiter.limit(lambda: settings.AUTH_FORGOT_PASSWORD_RATE_LIMIT)
async def forgot_password(
    body: ForgotPasswordRequest, request: Request, db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if user:
        raw = await issue_email_token("reset", user.id, settings.RESET_TOKEN_TTL_HOURS)
        reset_url = f"{settings.APP_BASE_URL.rstrip('/')}/reset-password?token={raw}"
        await _enqueue_email(
            request, user.email, "Reset your Arciv password", "reset_password",
            {"reset_url": reset_url, "ttl_hours": settings.RESET_TOKEN_TTL_HOURS},
        )
    return _GENERIC_EMAIL_SENT


@router.post("/reset-password", response_model=MessageResponse)
@limiter.limit(lambda: settings.AUTH_RESET_PASSWORD_RATE_LIMIT)
async def reset_password(body: ResetPasswordRequest, request: Request, db: AsyncSession = Depends(get_db)):
    user_id = await consume_email_token("reset", body.token)
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired reset link"
        )

    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid link")

    user.password_hash = hash_password(body.new_password)
    await db.commit()
    # Kill every existing session after a password reset.
    await revoke_all_for_user(db, user.id)

    return MessageResponse(message="Password updated. Please log in with your new password.")


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)):
    return current_user
