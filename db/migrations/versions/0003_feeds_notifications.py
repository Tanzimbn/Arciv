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

    op.add_column(
        "links",
        sa.Column("feed_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_links_feed_id",
        "links",
        "feeds",
        ["feed_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # Composite FK (feed_id, user_id) → feeds(id, user_id) cannot use ON DELETE SET NULL
    # because links.user_id is NOT NULL. Use a trigger instead to enforce ownership at
    # the persistence level: a link's feed_id must belong to the same user.
    op.execute("""
        CREATE OR REPLACE FUNCTION check_link_feed_ownership()
        RETURNS TRIGGER AS $$
        BEGIN
            IF NEW.feed_id IS NOT NULL THEN
                IF NOT EXISTS (
                    SELECT 1 FROM feeds
                    WHERE id = NEW.feed_id AND user_id = NEW.user_id
                ) THEN
                    RAISE EXCEPTION 'feed % does not belong to user %', NEW.feed_id, NEW.user_id;
                END IF;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE TRIGGER trg_link_feed_ownership
        BEFORE INSERT OR UPDATE ON links
        FOR EACH ROW EXECUTE FUNCTION check_link_feed_ownership();
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_link_feed_ownership ON links;")
    op.execute("DROP FUNCTION IF EXISTS check_link_feed_ownership();")
    op.drop_constraint("fk_links_feed_id", "links", type_="foreignkey")
    op.drop_column("links", "feed_id")
    op.drop_index("idx_notifications_user_unread", table_name="notifications")
    op.drop_table("notifications")
    op.drop_index("idx_feed_items_feed", table_name="feed_items")
    op.drop_table("feed_items")
    op.drop_table("feeds")
