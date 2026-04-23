"""Add tutor customization fields

Revision ID: 20260423_000009
Revises: 20260422_000008
Create Date: 2026-04-23 00:00:09.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260423_000009"
down_revision: Union[str, None] = "20260422_000008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("tutor_name", sa.String(length=80), server_default="KnowledgePal", nullable=False),
    )
    op.add_column(
        "users",
        sa.Column("tutor_tone", sa.String(length=80), server_default="Supportive", nullable=False),
    )
    op.add_column(
        "users",
        sa.Column("tutor_style", sa.String(length=120), server_default="Socratic guide", nullable=False),
    )
    op.add_column(
        "users",
        sa.Column("tutor_instructions", sa.String(length=1000), server_default="", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("users", "tutor_instructions")
    op.drop_column("users", "tutor_style")
    op.drop_column("users", "tutor_tone")
    op.drop_column("users", "tutor_name")
