"""initial: users and links tables

Revision ID: 0001
Revises:
Create Date: 2026-04-16

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("telegram_chat_id", sa.BigInteger(), nullable=True),
        sa.Column("ai_provider", sa.String(50), server_default="gemini", nullable=False),
        sa.Column("ai_api_key_enc", sa.Text(), nullable=True),
        sa.Column("feed_notify_telegram", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("feed_notify_inapp", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("email"),
    )

    op.create_table(
        "links",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("feed_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("canonical_url", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("favicon_url", sa.Text(), nullable=True),
        # AI fields
        sa.Column("content_type", sa.String(50), nullable=True),
        sa.Column("queue", sa.String(30), server_default="inbox", nullable=False),
        sa.Column("ai_summary", sa.Text(), nullable=True),
        sa.Column("ai_tags", postgresql.ARRAY(sa.Text()), nullable=True),
        sa.Column("ai_status", sa.String(30), server_default="pending", nullable=False),
        sa.Column("ai_provider_used", sa.String(50), nullable=True),
        sa.Column("ai_error", sa.Text(), nullable=True),
        sa.Column("ai_raw_response", postgresql.JSONB(), nullable=True),
        sa.Column("ai_attempt_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("ai_next_retry_at", sa.TIMESTAMP(timezone=True), nullable=True),
        # User state
        sa.Column("status", sa.String(20), server_default="active", nullable=False),
        sa.Column("fetch_status", sa.String(20), server_default="ok", nullable=False),
        sa.Column("done_at", sa.TIMESTAMP(timezone=True), nullable=True),
        # Timestamps
        sa.Column("saved_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("processed_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.UniqueConstraint("user_id", "canonical_url", name="uq_links_user_canonical"),
    )

    op.create_index("idx_links_user_queue", "links", ["user_id", "queue"])
    op.create_index(
        "idx_links_ai_retry",
        "links",
        ["ai_status", "ai_next_retry_at"],
        postgresql_where=sa.text("ai_status IN ('pending', 'failed')"),
    )


def downgrade() -> None:
    op.drop_index("idx_links_ai_retry", table_name="links")
    op.drop_index("idx_links_user_queue", table_name="links")
    op.drop_table("links")
    op.drop_table("users")
