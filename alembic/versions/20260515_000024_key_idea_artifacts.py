"""Add artifact_type and artifact_data to key_ideas for user-saved snippets

Revision ID: 20260515_000024
Revises: 20260515_000023
Create Date: 2026-05-15 00:00:24.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260515_000024"
down_revision: Union[str, None] = "20260515_000023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "key_ideas",
        sa.Column("artifact_type", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "key_ideas",
        sa.Column("artifact_data", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("key_ideas", "artifact_data")
    op.drop_column("key_ideas", "artifact_type")
