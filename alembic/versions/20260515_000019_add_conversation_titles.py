"""Add conversation titles

Revision ID: 20260515_000019
Revises: 20260514_000018
Create Date: 2026-05-15 00:00:19.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260515_000019"
down_revision: Union[str, None] = "20260514_000018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("conversations", sa.Column("title", sa.String(length=120), nullable=True))
    op.add_column(
        "conversations",
        sa.Column("title_manually_edited", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.alter_column("conversations", "title_manually_edited", server_default=None)


def downgrade() -> None:
    op.drop_column("conversations", "title_manually_edited")
    op.drop_column("conversations", "title")
