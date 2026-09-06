"""drop the Telegram integration columns

Revision ID: 0016_drop_telegram
Revises: 0015_ollama_cloud
Create Date: 2026-09-06
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0016_drop_telegram"
down_revision: Union[str, None] = "0015_ollama_cloud"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Telegram is removed from the product: the bot, the /api/telegram/* routes,
    # the daily-digest cron and the Settings UI are all gone, so these four
    # columns have no reader left.
    #
    # No data is lost that anyone had. The feature shipped disabled behind
    # TELEGRAM_ENABLED=false and was never turned on, so telegram_chat_id and
    # both link-token columns are NULL for every row, and feed_notify_telegram
    # only ever held its own default. Dropping them is a schema cleanup, not a
    # migration of user state.
    op.drop_column("users", "feed_notify_telegram")
    op.drop_column("users", "telegram_link_token_expires_at")
    op.drop_column("users", "telegram_link_token")
    op.drop_column("users", "telegram_chat_id")


def downgrade() -> None:
    # Restores the shape, not the contents — there were none to restore.
    op.add_column(
        "users", sa.Column("telegram_chat_id", sa.BigInteger(), nullable=True)
    )
    op.add_column(
        "users", sa.Column("telegram_link_token", sa.String(length=255), nullable=True)
    )
    op.add_column(
        "users",
        sa.Column(
            "telegram_link_token_expires_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "feed_notify_telegram",
            sa.Boolean(),
            server_default="true",
            nullable=False,
        ),
    )
