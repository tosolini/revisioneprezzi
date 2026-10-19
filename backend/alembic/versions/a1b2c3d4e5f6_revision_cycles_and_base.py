"""revision cycles, plan, scheduler run, index base link

Revision ID: a1b2c3d4e5f6
Revises: b7c9d1e2f304
Create Date: 2026-10-19 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "b7c9d1e2f304"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. base_year su index_series
    op.add_column(
        "index_series",
        sa.Column("base_year", sa.Integer(), nullable=True),
    )

    # 2. index_base_link
    op.create_table(
        "index_base_link",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("from_series_id", sa.String(length=50), nullable=False),
        sa.Column("to_series_id", sa.String(length=50), nullable=False),
        sa.Column("coefficient", sa.Numeric(18, 8), nullable=False),
        sa.Column("reference_period", sa.Date(), nullable=False),
        sa.Column("source", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["from_series_id"], ["index_series.id"]),
        sa.ForeignKeyConstraint(["to_series_id"], ["index_series.id"]),
        sa.UniqueConstraint("from_series_id", "to_series_id", name="uq_index_base_link"),
    )

    # 3. revision_plan
    op.create_table(
        "revision_plan",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("case_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("frequency", sa.String(length=20), nullable=False),
        sa.Column("anchor_period", sa.Date(), nullable=False),
        sa.Column("first_comparison_period", sa.Date(), nullable=False),
        sa.Column("next_comparison_period", sa.Date(), nullable=True),
        sa.Column("amount_policy", sa.String(length=20), nullable=False, server_default="period"),
        sa.Column("auto_generate", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("lead_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
        sa.Column("plan_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("readiness_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["case_id"], ["case_file.id"]),
        sa.UniqueConstraint("case_id", name="uq_revision_plan_case"),
    )

    # 4. revision_plan_series
    op.create_table(
        "revision_plan_series",
        sa.Column("plan_id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("series_id", sa.String(length=50), primary_key=True, nullable=False),
        sa.Column("weight", sa.Float(), nullable=False),
        sa.Column("frequency", sa.String(length=20), nullable=True),
        sa.Column("base_year", sa.Integer(), nullable=True),
        sa.Column("sdmx_query_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["plan_id"], ["revision_plan.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["series_id"], ["index_series.id"]),
    )

    # 5. revision_cycle (result_id senza FK per ora)
    op.create_table(
        "revision_cycle",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("plan_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("case_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sequence_no", sa.Integer(), nullable=False),
        sa.Column("base_period", sa.Date(), nullable=False),
        sa.Column("comparison_period", sa.Date(), nullable=False),
        sa.Column("amount", sa.Float(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="planned"),
        sa.Column("result_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("snapshot_json", postgresql.JSONB(), nullable=True),
        sa.Column("snapshot_hash", sa.String(length=64), nullable=True),
        sa.Column("data_ready_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("calculated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by", sa.String(length=255), nullable=True),
        sa.Column("void_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["plan_id"], ["revision_plan.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["case_id"], ["case_file.id"]),
        sa.UniqueConstraint("plan_id", "comparison_period", name="uq_revision_cycle_period"),
        sa.UniqueConstraint("plan_id", "sequence_no", name="uq_revision_cycle_seq"),
    )

    # 6. revision_result.cycle_id
    op.add_column(
        "revision_result",
        sa.Column("cycle_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_revision_result_cycle", "revision_result", "revision_cycle",
        ["cycle_id"], ["id"],
    )

    # 7. FK revision_cycle.result_id -> revision_result.id
    op.create_foreign_key(
        "fk_revision_cycle_result", "revision_cycle", "revision_result",
        ["result_id"], ["id"],
    )

    # 8. scheduler_run
    op.create_table(
        "scheduler_run",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("trigger", sa.String(length=20), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="running"),
        sa.Column("plans_evaluated", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cycles_created", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("queries_run", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("queries_failed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("details_json", postgresql.JSONB(), nullable=True),
        sa.Column("error_text", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("scheduler_run")
    op.drop_constraint("fk_revision_cycle_result", "revision_cycle", type_="foreignkey")
    op.drop_constraint("fk_revision_result_cycle", "revision_result", type_="foreignkey")
    op.drop_column("revision_result", "cycle_id")
    op.drop_table("revision_cycle")
    op.drop_table("revision_plan_series")
    op.drop_table("revision_plan")
    op.drop_table("index_base_link")
    op.drop_column("index_series", "base_year")