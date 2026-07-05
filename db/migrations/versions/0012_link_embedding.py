"""add embedding vector to links for semantic search

Revision ID: 0012_link_embedding
Revises: 0011_auth_hardening
Create Date: 2026-07-01
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector

revision: str = "0012_link_embedding"
down_revision: Union[str, None] = "0011_auth_hardening"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Requires the pgvector image (docker-compose uses pgvector/pgvector:pg16);
    # managed Postgres (Neon) ships the extension too.
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.add_column("links", sa.Column("embedding", Vector(384), nullable=True))
    # HNSW index (cosine) — no training step, unlike IVFFlat, so it works on an
    # empty/partial table and stays correct as rows are embedded incrementally.
    op.create_index(
        "idx_links_embedding_hnsw",
        "links",
        ["embedding"],
        postgresql_using="hnsw",
        postgresql_with={"m": 16, "ef_construction": 64},
        postgresql_ops={"embedding": "vector_cosine_ops"},
    )


def downgrade() -> None:
    op.drop_index("idx_links_embedding_hnsw", table_name="links")
    op.drop_column("links", "embedding")
    # Leave the `vector` extension in place — other objects may rely on it.
