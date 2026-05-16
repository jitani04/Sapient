"""Add BKT knowledge state

Revision ID: 20260515_000021
Revises: 20260515_000020
Create Date: 2026-05-15 00:00:21.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260515_000021"
down_revision: Union[str, None] = "20260515_000020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("quizzes", sa.Column("concept", sa.String(length=255), nullable=True))
    op.add_column("project_profiles", sa.Column("knowledge_state", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("project_profiles", "knowledge_state")
    op.drop_column("quizzes", "concept")
