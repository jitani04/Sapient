"""Add session artifacts (key_ideas table, conversation.summary)

Revision ID: 20260423_000010
Revises: 20260423_000009
Create Date: 2026-04-23 00:00:10.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260423_000010"
down_revision: Union[str, None] = "20260423_000009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("conversations", sa.Column("summary", sa.JSON(), nullable=True))

    op.create_table(
        "key_ideas",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("conversation_id", sa.Integer(), sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("subject", sa.String(255), nullable=True),
        sa.Column("concept", sa.String(255), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_key_ideas_user_id", "key_ideas", ["user_id"])
    op.create_index("ix_key_ideas_conversation_id", "key_ideas", ["conversation_id"])


def downgrade() -> None:
    op.drop_index("ix_key_ideas_conversation_id", table_name="key_ideas")
    op.drop_index("ix_key_ideas_user_id", table_name="key_ideas")
    op.drop_table("key_ideas")
    op.drop_column("conversations", "summary")
