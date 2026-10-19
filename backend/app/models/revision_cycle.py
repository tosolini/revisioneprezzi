import uuid
from datetime import date, datetime
from enum import Enum

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class RevisionCycleStatus(str, Enum):
    planned = "planned"
    waiting_data = "waiting_data"
    ready = "ready"
    calculated = "calculated"
    approved = "approved"
    void = "void"


class RevisionCycle(Base):
    __tablename__ = "revision_cycle"
    __table_args__ = (
        UniqueConstraint("plan_id", "comparison_period", name="uq_revision_cycle_period"),
        UniqueConstraint("plan_id", "sequence_no", name="uq_revision_cycle_seq"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("revision_plan.id", ondelete="CASCADE"), nullable=False
    )
    case_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("case_file.id"), nullable=False
    )
    sequence_no: Mapped[int] = mapped_column(Integer)
    base_period: Mapped[date] = mapped_column(Date)
    comparison_period: Mapped[date] = mapped_column(Date)
    amount: Mapped[float | None] = mapped_column(nullable=True)
    status: Mapped[str] = mapped_column(String(20), default=RevisionCycleStatus.planned.value)
    result_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    snapshot_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    snapshot_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    data_ready_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    calculated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    void_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    plan = relationship("RevisionPlan", back_populates="cycles")
    case_file = relationship("CaseFile")
