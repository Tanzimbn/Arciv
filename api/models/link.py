import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    ARRAY,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from pgvector.sqlalchemy import Vector

from api.database import Base

if TYPE_CHECKING:  # import-time cycle: api.models.user imports Link back
    from api.models.user import User


class Link(Base):
    __tablename__ = "links"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    feed_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    url: Mapped[str] = mapped_column(Text, nullable=False)
    canonical_url: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    favicon_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    published_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # AI fields
    content_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    queue: Mapped[str] = mapped_column(String(30), default="inbox")
    ai_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_tags: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    ai_status: Mapped[str] = mapped_column(String(30), default="pending")
    ai_provider_used: Mapped[str | None] = mapped_column(String(50), nullable=True)
    ai_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_raw_response: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    ai_attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    ai_next_retry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # User state
    status: Mapped[str] = mapped_column(String(20), default="active")
    fetch_status: Mapped[str] = mapped_column(String(20), default="ok")
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_insights: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)

    # Semantic-search embedding (384-dim, fastembed). Populated asynchronously by
    # the worker (worker/embed.py); nullable and never serialized in LinkResponse.
    embedding: Mapped[list[float] | None] = mapped_column(Vector(384), nullable=True)

    # Timestamps
    saved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=func.now())
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship("User", back_populates="links")

    __table_args__ = (
        Index("idx_links_user_queue", "user_id", "queue"),
        Index(
            "idx_links_ai_retry",
            "ai_status",
            "ai_next_retry_at",
            postgresql_where="ai_status IN ('pending', 'failed')",
        ),
    )
