import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, Boolean, DateTime, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.database import Base

if TYPE_CHECKING:  # import-time cycle: these modules import User back
    from api.models.link import Link
    from api.models.refresh_token import RefreshToken


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    email_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    telegram_chat_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    telegram_link_token: Mapped[str | None] = mapped_column(String(255), nullable=True)
    telegram_link_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ai_provider: Mapped[str] = mapped_column(String(50), default="gemini")
    # NULL = use the provider's DEFAULT_MODEL. Stored per user because
    # providers retire models, and that must be fixable from Settings
    # rather than by a redeploy.
    ai_model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    ai_api_key_enc: Mapped[str | None] = mapped_column(nullable=True)
    feed_notify_telegram: Mapped[bool] = mapped_column(Boolean, default=True)
    feed_notify_inapp: Mapped[bool] = mapped_column(Boolean, default=True)
    username: Mapped[str | None] = mapped_column(String(30), unique=True, nullable=True)
    # Running approx byte total of this user's persisted content (see
    # api/utils/storage.py). Maintained by deltas at every link mutation site and
    # enforced against MAX_STORAGE_BYTES_PER_USER at link-create.
    storage_bytes: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default="0"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=func.now())

    links: Mapped[list["Link"]] = relationship("Link", back_populates="user")
    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(
        "RefreshToken", back_populates="user", cascade="all, delete-orphan"
    )

    @property
    def is_admin(self) -> bool:
        from api.config import settings

        return settings.is_admin(self.email)
