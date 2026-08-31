"""Self-serve account lifecycle: data export and full deletion (NFR-PUB-07)."""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy import delete as sa_delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import get_current_user
from api.models.feed import Feed, FeedItem
from api.models.link import Link
from api.models.notification import Notification
from api.models.user import User
from api.schemas.account import AccountDeleteRequest
from api.utils.security import verify_password

router = APIRouter()


def _coerce(value):
    """Make a column value JSON-serialisable (JSONResponse uses plain json)."""
    if isinstance(value, (datetime,)):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    return value


def _row(obj, fields: list[str]) -> dict:
    return {f: _coerce(getattr(obj, f)) for f in fields}


_LINK_FIELDS = [
    "id", "feed_id", "url", "canonical_url", "title", "description", "favicon_url",
    "published_date", "content_type", "queue", "ai_summary", "ai_tags", "ai_status",
    "ai_provider_used", "ai_insights", "status", "fetch_status", "done_at", "notes",
    "saved_at", "processed_at",
]  # deliberately excludes the raw `embedding` vector and internal ai_raw_response
_FEED_FIELDS = [
    "id", "site_url", "feed_url", "title", "favicon_url", "status", "category",
    "last_checked_at", "consecutive_failures", "total_items_received", "created_at",
]
_FEED_ITEM_FIELDS = ["id", "feed_id", "guid", "link_id", "seen_at"]
_NOTIFICATION_FIELDS = ["id", "type", "title", "body", "is_read", "created_at"]


@router.get("/export")
async def export_account(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Download everything this account owns as a single JSON file.

    Every query is scoped to ``current_user.id``. Password hash and any key
    material are never included — only whether an AI key is configured.
    """
    links = (
        await db.execute(select(Link).where(Link.user_id == current_user.id))
    ).scalars().all()
    feeds = (
        await db.execute(select(Feed).where(Feed.user_id == current_user.id))
    ).scalars().all()
    feed_items = (
        await db.execute(
            select(FeedItem)
            .join(Feed, FeedItem.feed_id == Feed.id)
            .where(Feed.user_id == current_user.id)
        )
    ).scalars().all()
    notifications = (
        await db.execute(
            select(Notification).where(Notification.user_id == current_user.id)
        )
    ).scalars().all()

    payload = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "profile": {
            "id": str(current_user.id),
            "email": current_user.email,
            "username": current_user.username,
            "ai_provider": current_user.ai_provider,
            "ai_model": current_user.ai_model,
            "ai_key_configured": current_user.ai_api_key_enc is not None,
            "email_verified": current_user.email_verified,
            "feed_notify_telegram": current_user.feed_notify_telegram,
            "feed_notify_inapp": current_user.feed_notify_inapp,
            "created_at": _coerce(current_user.created_at),
        },
        "links": [_row(x, _LINK_FIELDS) for x in links],
        "feeds": [_row(x, _FEED_FIELDS) for x in feeds],
        "feed_items": [_row(x, _FEED_ITEM_FIELDS) for x in feed_items],
        "notifications": [_row(x, _NOTIFICATION_FIELDS) for x in notifications],
    }

    filename = f"arciv-export-{datetime.now(timezone.utc):%Y%m%d}.json"
    return JSONResponse(
        content=payload,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    body: AccountDeleteRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Permanently delete the account and everything it owns.

    Requires the current password. Deleting the ``users`` row cascades to
    links, feeds, feed_items, notifications and refresh tokens via the existing
    ``ondelete="CASCADE"`` foreign keys; Redis email tokens self-expire.
    """
    if not verify_password(body.password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Password is incorrect."
        )

    # Delete via a Core statement (not ``db.delete(current_user)``) so Postgres'
    # own ``ondelete="CASCADE"`` removes owned rows. The ORM cascade would
    # instead try to NULL each child's ``user_id`` first, which the NOT NULL
    # constraint rejects.
    await db.execute(sa_delete(User).where(User.id == current_user.id))
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
