import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.database import Base


class Feed(Base):
    """
    RSS/Atom feed subscription owned by a user.
    site_url: URL user originally pasted (blog homepage or direct feed)
    feed_url: resolved RSS/Atom endpoint used for polling
    status: active | paused | degraded (7 failures) | dead (30 failures)
    last_etag: ETag (entity tag: server generated fingerprint of response content to track new content) from last response
    """
    __tablename__ = "feeds"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    site_url: Mapped[str] = mapped_column(Text, nullable=False)
    feed_url: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    favicon_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active")
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_etag: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_modified: Mapped[str | None] = mapped_column(Text, nullable=True)
    consecutive_failures: Mapped[int] = mapped_column(Integer, default=0)
    total_items_received: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=func.now())

    feed_items: Mapped[list["FeedItem"]] = relationship(
        "FeedItem", back_populates="feed", cascade="all, delete-orphan"
    )


class FeedItem(Base):
    __tablename__ = "feed_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    feed_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("feeds.id", ondelete="CASCADE"), nullable=False)
    guid: Mapped[str] = mapped_column(Text, nullable=False)
    link_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("links.id", ondelete="SET NULL"), nullable=True)
    seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=func.now())

    feed: Mapped["Feed"] = relationship("Feed", back_populates="feed_items")

    __table_args__ = (
        Index("idx_feed_items_feed", "feed_id"),
        UniqueConstraint("feed_id", "guid", name="uq_feed_items_feed_guid"),
    )
