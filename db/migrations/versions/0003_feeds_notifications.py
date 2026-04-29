"""feeds, feed_items, notifications; add feed_id FK on links

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-29
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "feeds",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("site_url", sa.Text(), nullable=False),
        sa.Column("feed_url", sa.Text(), nullable=False),
        sa.Column("title", sa.String(255), nullable=True),
        sa.Column("favicon_url", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), server_default="active", nullable=False),
        sa.Column("last_checked_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("last_etag", sa.Text(), nullable=True),
        sa.Column("last_modified", sa.Text(), nullable=True),
        sa.Column("consecutive_failures", sa.Integer(), server_default="0", nullable=False),
        sa.Column("total_items_received", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("user_id", "feed_url", name="uq_feeds_user_feed_url"),
    )

    op.create_table(
        "feed_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("feed_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("feeds.id", ondelete="CASCADE"), nullable=False),
        sa.Column("guid", sa.Text(), nullable=False),
        sa.Column("link_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("links.id", ondelete="SET NULL"), nullable=True),
        sa.Column("seen_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("feed_id", "guid", name="uq_feed_items_feed_guid"),
    )
    op.create_index("idx_feed_items_feed", "feed_items", ["feed_id"])

    op.create_table(
        "notifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", sa.String(50), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("is_read", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index(
        "idx_notifications_user_unread",
        "notifications",
        ["user_id", "is_read"],
        postgresql_where=sa.text("is_read = false"),
    )

    op.create_foreign_key(
        "fk_links_feed_id",
        "links",
        "feeds",
        ["feed_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_links_feed_id", "links", type_="foreignkey")
    op.drop_index("idx_notifications_user_unread", table_name="notifications")
    op.drop_table("notifications")
    op.drop_index("idx_feed_items_feed", table_name="feed_items")
    op.drop_table("feed_items")
    op.drop_table("feeds")
