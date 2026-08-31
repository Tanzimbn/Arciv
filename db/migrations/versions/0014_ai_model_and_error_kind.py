"""per-user AI model choice, and permanent-vs-transient AI failure marker

Revision ID: 0014_ai_model_and_error_kind
Revises: 0013_user_storage_bytes
Create Date: 2026-08-25
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0014_ai_model_and_error_kind"
down_revision: Union[str, None] = "0013_user_storage_bytes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Both nullable with no backfill, deliberately. NULL on users.ai_model means
    # "the provider's default", which is exactly how every existing account
    # already behaves. NULL on links.ai_error_kind means "transient", so every
    # existing failed link stays on the retry path it is on today.
    op.add_column("users", sa.Column("ai_model", sa.String(length=100), nullable=True))
    op.add_column("links", sa.Column("ai_error_kind", sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column("links", "ai_error_kind")
    op.drop_column("users", "ai_model")
