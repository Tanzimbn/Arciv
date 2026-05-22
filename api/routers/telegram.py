import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import get_current_user
from api.models.link import Link
from api.models.user import User
from api.models.feed import Feed
from api.schemas.telegram import TelegramLinkResponse, DailyDigestItem, DailyDigestResponse

router = APIRouter()


@router.post("/link-token", response_model=TelegramLinkResponse)
async def generate_telegram_link_token(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate a one-time token for linking Telegram account"""
    # Generate a secure token
    token = secrets.token_urlsafe(16)
    
    # Store token with expiration (24 hours)
    # For MVP, we'll store it directly in the user table
    # In production, you'd want a separate tokens table
    expires_at = datetime.now(timezone.utc) + timedelta(hours=24)
    
    await db.execute(
        update(User)
        .where(User.id == current_user.id)
        .values(
            telegram_link_token=token,
            telegram_link_token_expires_at=expires_at
        )
    )
    await db.commit()
    
    return TelegramLinkResponse(
        token=token,
        expires_at=expires_at
    )


@router.post("/submit-link", status_code=status.HTTP_201_CREATED)
async def submit_link_via_telegram(
    user_id: str,
    url: str,
    db: AsyncSession = Depends(get_db),
):
    """Submit a URL via Telegram bot (internal endpoint)"""
    # Find the user
    result = await db.execute(
        select(User).where(User.id == user_id)
    )
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Import the link creation logic from links router
    from api.routers.links import create_link_for_user
    try:
        link = await create_link_for_user(db, user, url)
        return {"id": link.id, "status": "saved"}
    except Exception as e:
        if "already exists" in str(e):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"message": "You already saved this link"}
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to save link"
        )


@router.get("/daily-digest/{user_id}", response_model=DailyDigestResponse)
async def get_daily_digest(
    user_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get daily digest for a user (internal endpoint for Telegram bot)"""
    # Get links created in the last 24 hours from feeds
    yesterday = datetime.now(timezone.utc) - timedelta(days=1)
    
    result = await db.execute(
        select(Link, Feed)
        .join(Feed, Link.feed_id == Feed.id)
        .where(
            Link.user_id == user_id,
            Link.saved_at >= yesterday,
            Link.feed_id.isnot(None)
        )
        .order_by(Link.saved_at.desc())
        .limit(10)
    )
    
    items = []
    for row in result:
        link, feed = row
        items.append(DailyDigestItem(
            title=link.title or "Untitled",
            feed_name=feed.title or "Unknown Feed",
            url=link.url
        ))
    
    return DailyDigestResponse(items=items)
