"""add running storage_bytes total to users

Revision ID: 0013_user_storage_bytes
Revises: 0012_link_embedding
Create Date: 2026-08-03
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0013_user_storage_bytes"
down_revision: Union[str, None] = "0012_link_embedding"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "storage_bytes",
            sa.BigInteger(),
            nullable=False,
            server_default="0",
        ),
    )
    # Backfill from existing links so the running total is accurate at launch.
    # Mirrors api/utils/storage.link_bytes: octet_length of each text field +
    # the JSONB blob as text + a fixed 1536 bytes per embedded row (384 * 4).
    op.execute(
        """
        UPDATE users u
        SET storage_bytes = COALESCE(agg.total, 0)
        FROM (
            SELECT
                user_id,
                SUM(
                    octet_length(COALESCE(url, ''))
                    + octet_length(COALESCE(canonical_url, ''))
                    + octet_length(COALESCE(title, ''))
                    + octet_length(COALESCE(description, ''))
                    + octet_length(COALESCE(favicon_url, ''))
                    + octet_length(COALESCE(ai_summary, ''))
                    + octet_length(COALESCE(ai_error, ''))
                    + octet_length(COALESCE(notes, ''))
                    + octet_length(COALESCE(array_to_string(ai_tags, ' '), ''))
                    + octet_length(COALESCE(array_to_string(ai_insights, ' '), ''))
                    + octet_length(COALESCE(ai_raw_response::text, ''))
                    + CASE WHEN embedding IS NOT NULL THEN 1536 ELSE 0 END
                ) AS total
            FROM links
            GROUP BY user_id
        ) agg
        WHERE agg.user_id = u.id
        """
    )


def downgrade() -> None:
    op.drop_column("users", "storage_bytes")
