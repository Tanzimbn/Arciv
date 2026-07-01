import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import require_admin
from api.models.user import User
from api.schemas.admin import (
    AdminStatsResponse,
    SignupPoint,
    StatsTotals,
    TrafficPoint,
)
from api.schemas.auth import MessageResponse, UserResponse

router = APIRouter()


def _as_int(v) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


@router.get("/stats", response_model=AdminStatsResponse)
async def stats(
    request: Request,
    days: int = Query(30, ge=1, le=90),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    today = datetime.now(timezone.utc).date()
    dates = [
        (today - timedelta(days=i)).strftime("%Y-%m-%d")
        for i in range(days - 1, -1, -1)
    ]

    # Traffic + unique visitors from Redis aggregate counters. Missing days = 0.
    redis = request.app.state.analytics_redis
    req_counts = await redis.mget([f"stats:req:{d}" for d in dates])
    err_counts = await redis.mget([f"stats:err:{d}" for d in dates])
    uv_pipe = redis.pipeline(transaction=False)
    for d in dates:
        uv_pipe.pfcount(f"stats:uv:{d}")
    uv_counts = await uv_pipe.execute()

    traffic = [
        TrafficPoint(
            date=d,
            requests=_as_int(req_counts[i]),
            errors=_as_int(err_counts[i]),
            unique_visitors=_as_int(uv_counts[i]),
        )
        for i, d in enumerate(dates)
    ]

    # Signups per day from users.created_at (zero-filled to a continuous series).
    window_start = today - timedelta(days=days - 1)
    day_col = func.date_trunc("day", User.created_at)
    result = await db.execute(
        select(day_col.label("d"), func.count().label("n"))
        .where(User.created_at >= window_start)
        .group_by("d")
    )
    signups_by_date = {
        row.d.strftime("%Y-%m-%d"): row.n for row in result.all()
    }
    user_growth = [
        SignupPoint(date=d, signups=signups_by_date.get(d, 0)) for d in dates
    ]

    total_users = await db.scalar(select(func.count()).select_from(User))
    total_verified = await db.scalar(
        select(func.count()).select_from(User).where(User.email_verified.is_(True))
    )
    today_str = today.strftime("%Y-%m-%d")
    requests_today = _as_int(await redis.get(f"stats:req:{today_str}"))
    unique_today = _as_int(await redis.pfcount(f"stats:uv:{today_str}"))

    return AdminStatsResponse(
        traffic=traffic,
        user_growth=user_growth,
        totals=StatsTotals(
            users=total_users or 0,
            verified=total_verified or 0,
            requests_today=requests_today,
            unique_today=unique_today,
        ),
    )


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
