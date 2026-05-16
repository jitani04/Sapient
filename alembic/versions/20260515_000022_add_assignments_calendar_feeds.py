"""Add assignments and calendar feeds

Revision ID: 20260515_000022
Revises: 20260515_000021
Create Date: 2026-05-15 00:00:22.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260515_000022"
down_revision: Union[str, None] = "20260515_000021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "calendar_feeds",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("subject", sa.String(length=255), nullable=True),
        sa.Column("source", sa.String(length=50), server_default="canvas", nullable=False),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_calendar_feeds_user_id"), "calendar_feeds", ["user_id"], unique=False)

    op.create_table(
        "assignments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("feed_id", sa.Integer(), nullable=True),
        sa.Column("subject", sa.String(length=255), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source", sa.String(length=50), server_default="manual", nullable=False),
        sa.Column("source_uid", sa.String(length=512), nullable=True),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("completed", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["feed_id"], ["calendar_feeds.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "feed_id", "source_uid", name="uq_assignment_user_feed_source_uid"),
    )
    op.create_index(op.f("ix_assignments_due_at"), "assignments", ["due_at"], unique=False)
    op.create_index(op.f("ix_assignments_feed_id"), "assignments", ["feed_id"], unique=False)
    op.create_index(op.f("ix_assignments_subject"), "assignments", ["subject"], unique=False)
    op.create_index(op.f("ix_assignments_user_id"), "assignments", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_assignments_user_id"), table_name="assignments")
    op.drop_index(op.f("ix_assignments_subject"), table_name="assignments")
    op.drop_index(op.f("ix_assignments_feed_id"), table_name="assignments")
    op.drop_index(op.f("ix_assignments_due_at"), table_name="assignments")
    op.drop_table("assignments")
    op.drop_index(op.f("ix_calendar_feeds_user_id"), table_name="calendar_feeds")
    op.drop_table("calendar_feeds")
