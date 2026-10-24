"""add created_at indexes for list/dashboard queries

diagnostic_sessions, training_experiments and evaluation_runs are all listed
ordered by created_at DESC, but only status/scenario were indexed, forcing a
full sort on every page as row counts grow.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-25 00:00:00.000000
"""

from __future__ import annotations

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("diagnostic_sessions", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_diagnostic_sessions_created_at"), ["created_at"], unique=False
        )
    with op.batch_alter_table("training_experiments", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_training_experiments_created_at"), ["created_at"], unique=False
        )
    with op.batch_alter_table("evaluation_runs", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_evaluation_runs_created_at"), ["created_at"], unique=False
        )


def downgrade() -> None:
    with op.batch_alter_table("evaluation_runs", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_evaluation_runs_created_at"))
    with op.batch_alter_table("training_experiments", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_training_experiments_created_at"))
    with op.batch_alter_table("diagnostic_sessions", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_diagnostic_sessions_created_at"))
