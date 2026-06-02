"""Add notes column to links

Revision ID: 0008_link_notes
Revises: 0007_username
Create Date: 2026-06-02 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008_link_notes"
down_revision: Union[str, None] = "0007_username"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("links", sa.Column("notes", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("links", "notes")
