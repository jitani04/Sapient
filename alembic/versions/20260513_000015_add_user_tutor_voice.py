"""Add user tutor voice

Revision ID: 20260513_000015
Revises: 20260511_000014
Create Date: 2026-05-13 00:00:15.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260513_000015"
down_revision: Union[str, None] = "20260511_000014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("tutor_voice", sa.String(length=32), server_default="nova", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("users", "tutor_voice")
