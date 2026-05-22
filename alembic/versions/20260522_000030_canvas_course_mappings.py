"""Add course_mappings to calendar_feeds

Revision ID: 20260522_000030
Revises: 20260522_000029
Create Date: 2026-05-22 00:00:30.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260522_000030"
down_revision: Union[str, None] = "20260522_000029"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("calendar_feeds", sa.Column("course_mappings", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("calendar_feeds", "course_mappings")
