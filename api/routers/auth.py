from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import create_access_token, get_current_user
from api.models.user import User
from api.schemas.auth import LoginRequest, RegisterRequest, TokenResponse, UserResponse
from api.utils.security import hash_password, verify_password
from api.utils.username import generate_username

router = APIRouter()


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
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

    return TokenResponse(access_token=create_access_token(user.id))


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    return TokenResponse(access_token=create_access_token(user.id))


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)):
    return current_user
