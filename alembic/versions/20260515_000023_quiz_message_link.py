"""Link quizzes to the assistant message that generated them

Revision ID: 20260515_000023
Revises: 20260515_000022
Create Date: 2026-05-15 00:00:23.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260515_000023"
down_revision: Union[str, None] = "20260515_000022"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "quizzes",
        sa.Column("message_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_quizzes_message_id",
        "quizzes",
        "messages",
        ["message_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_quizzes_message_id", "quizzes", ["message_id"])


def downgrade() -> None:
    op.drop_index("ix_quizzes_message_id", table_name="quizzes")
    op.drop_constraint("fk_quizzes_message_id", "quizzes", type_="foreignkey")
    op.drop_column("quizzes", "message_id")
