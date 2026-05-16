"""Add learning map progress

Revision ID: 20260515_000020
Revises: 20260515_000019
Create Date: 2026-05-15 00:00:20.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260515_000020"
down_revision: Union[str, None] = "20260515_000019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("project_profiles", sa.Column("learning_map_progress", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("project_profiles", "learning_map_progress")
