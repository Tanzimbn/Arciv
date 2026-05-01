import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, String, func, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    telegram_chat_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    telegram_link_token: Mapped[str | None] = mapped_column(String(255), nullable=True)
    telegram_link_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ai_provider: Mapped[str] = mapped_column(String(50), default="gemini")
    ai_api_key_enc: Mapped[str | None] = mapped_column(nullable=True)
    feed_notify_telegram: Mapped[bool] = mapped_column(Boolean, default=True)
    feed_notify_inapp: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(default=func.now())

    links: Mapped[list["Link"]] = relationship("Link", back_populates="user")
