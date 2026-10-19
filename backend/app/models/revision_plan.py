import uuid
from datetime import date, datetime
from enum import Enum

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, func, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class RevisionPlanStatus(str, Enum):
    draft = "draft"
    active = "active"
    paused = "paused"
    closed = "closed"


class RevisionPlan(Base):
    __tablename__ = "revision_plan"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("case_file.id"), unique=True, nullable=False
    )
    frequency: Mapped[str] = mapped_column(String(20))  # monthly|quarterly|semiannual|annual
    anchor_period: Mapped[date] = mapped_column(Date)
    first_comparison_period: Mapped[date] = mapped_column(Date)
    next_comparison_period: Mapped[date | None] = mapped_column(Date, nullable=True)
    amount_policy: Mapped[str] = mapped_column(String(20), default="period")
    auto_generate: Mapped[bool] = mapped_column(default=True)
    lead_days: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default=RevisionPlanStatus.draft.value)
    plan_version: Mapped[int] = mapped_column(Integer, default=1)
    readiness_checked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    case_file = relationship("CaseFile", back_populates="revision_plan", uselist=False)
    series = relationship("RevisionPlanSeries", back_populates="plan", cascade="all, delete-orphan")
    cycles = relationship("RevisionCycle", back_populates="plan", cascade="all, delete-orphan")


class RevisionPlanSeries(Base):
    __tablename__ = "revision_plan_series"
    __table_args__ = (UniqueConstraint("plan_id", "series_id", name="uq_revision_plan_series"),)

    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("revision_plan.id", ondelete="CASCADE"), primary_key=True
    )
    series_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("index_series.id"), primary_key=True
    )
    weight: Mapped[float] = mapped_column()
    frequency: Mapped[str | None] = mapped_column(String(20), nullable=True)
    base_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sdmx_query_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    plan = relationship("RevisionPlan", back_populates="series")
    series = relationship("IndexSeries")
