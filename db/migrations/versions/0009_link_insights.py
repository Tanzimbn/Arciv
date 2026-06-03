"""Add ai_insights column to links

Revision ID: 0009_link_insights
Revises: 0008_link_notes
Create Date: 2026-06-02 12:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009_link_insights"
down_revision: Union[str, None] = "0008_link_notes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "links",
        sa.Column("ai_insights", postgresql.ARRAY(sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("links", "ai_insights")
