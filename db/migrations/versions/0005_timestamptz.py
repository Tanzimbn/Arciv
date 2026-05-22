"""Convert all datetime columns to TIMESTAMPTZ

Existing naive timestamps are interpreted as UTC (every code path that wrote
them used UTC, just without tzinfo). The `USING ... AT TIME ZONE 'UTC'` clause
makes that interpretation explicit so existing values aren't silently shifted
by the server's session timezone.

Revision ID: 0005_timestamptz
Revises: 0004_telegram_fields
Create Date: 2026-05-22 13:30:00.000000
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0005_timestamptz"
down_revision: Union[str, None] = "0004_telegram_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_COLUMNS = [
    ("users", "telegram_link_token_expires_at"),
    ("users", "created_at"),
    ("links", "ai_next_retry_at"),
    ("links", "done_at"),
    ("links", "saved_at"),
    ("links", "processed_at"),
    ("feeds", "last_checked_at"),
    ("feeds", "created_at"),
    ("feed_items", "seen_at"),
    ("notifications", "created_at"),
    ("jobs", "started_at"),
    ("jobs", "finished_at"),
    ("jobs", "created_at"),
]


def upgrade() -> None:
    for table, column in _COLUMNS:
        op.execute(
            f"ALTER TABLE {table} ALTER COLUMN {column} TYPE TIMESTAMPTZ "
            f"USING {column} AT TIME ZONE 'UTC'"
        )


def downgrade() -> None:
    for table, column in _COLUMNS:
        op.execute(
            f"ALTER TABLE {table} ALTER COLUMN {column} TYPE TIMESTAMP "
            f"USING ({column} AT TIME ZONE 'UTC')"
        )
