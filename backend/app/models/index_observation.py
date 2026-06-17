import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class IndexObservation(Base):
    __tablename__ = "index_observation"
    __table_args__ = (
        UniqueConstraint("series_id", "ref_period", name="uq_series_ref_period"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    series_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("index_series.id")
    )
    ref_period: Mapped[date] = mapped_column(Date, comment="period start date")
    value: Mapped[float] = mapped_column(Float)
    is_definitive: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    series = relationship("IndexSeries", back_populates="observations")
