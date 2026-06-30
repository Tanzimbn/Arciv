import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import require_admin
from api.models.user import User
from api.schemas.auth import MessageResponse, UserResponse

router = APIRouter()


@router.get("/users", response_model=list[UserResponse])
async def list_users(
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    return result.scalars().all()


@router.delete("/users/{user_id}", response_model=MessageResponse)
async def delete_user(
    user_id: uuid.UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if user_id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You can't delete your own admin account.",
        )
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    email = user.email
    # Core DELETE so Postgres FK cascades remove links / feeds / notifications /
    # refresh tokens in one shot (ORM delete would try to NULL links.user_id).
    await db.execute(delete(User).where(User.id == user_id))
    await db.commit()
    return MessageResponse(message=f"Deleted {email}.")
