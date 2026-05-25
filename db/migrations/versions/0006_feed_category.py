"""Add category column to feeds

Revision ID: 0006_feed_category
Revises: 0005_timestamptz
Create Date: 2026-05-24 17:30:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006_feed_category"
down_revision: Union[str, None] = "0005_timestamptz"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("feeds", sa.Column("category", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("feeds", "category")
