"""retire self-hosted Ollama credentials

Revision ID: 0015_ollama_cloud
Revises: 0014_ai_model_and_error_kind
Create Date: 2026-08-31
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0015_ollama_cloud"
down_revision: Union[str, None] = "0014_ai_model_and_error_kind"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # The `ollama` provider id survives this release but means something else:
    # it used to store the base URL of the user's own server in ai_api_key_enc
    # and a locally pulled tag (`llama3:8b`) in ai_model; it now stores a bearer
    # key for https://ollama.com and a model from that catalogue.
    #
    # Carrying the old values forward would 401 every classify with a URL sent
    # as a credential, or 404 on a model the cloud has never heard of — an
    # outage the user cannot see the cause of. Nulling both instead drops those
    # accounts into the existing "no key configured" banner, which asks them to
    # reconnect and says so.
    #
    # DATA LOSS, DELIBERATE, NOT UNDONE BY THE DOWNGRADE: the saved server
    # address is gone after this. It was an address the user typed, recoverable
    # by typing it again; a real secret would not be treated this way.
    op.execute(
        "UPDATE users SET ai_api_key_enc = NULL, ai_model = NULL "
        "WHERE ai_provider = 'ollama'"
    )


def downgrade() -> None:
    # Nothing to restore. The old credentials were overwritten, not moved, and
    # inventing a base URL to put back would be worse than leaving the column
    # empty for the banner to catch.
    pass
