"""Rename legacy KnowledgePal tutor name

Revision ID: 20260514_000018
Revises: 20260514_000017
Create Date: 2026-05-14 00:00:18.000000

"""

from typing import Sequence, Union

from alembic import op

revision: str = "20260514_000018"
down_revision: Union[str, None] = "20260514_000017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE users SET tutor_name = 'Sapient' WHERE lower(tutor_name) = 'knowledgepal'")


def downgrade() -> None:
    pass
