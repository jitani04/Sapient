"""Add model column to conversations for per-conversation LLM choice

Revision ID: 20260518_000025
Revises: 20260515_000024
Create Date: 2026-05-18 00:00:25.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260518_000025"
down_revision: Union[str, None] = "20260515_000024"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "conversations",
        sa.Column("model", sa.String(length=64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("conversations", "model")
