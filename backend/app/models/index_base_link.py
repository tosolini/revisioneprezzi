import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class IndexBaseLink(Base):
    __tablename__ = "index_base_link"
    __table_args__ = (
        UniqueConstraint("from_series_id", "to_series_id", name="uq_index_base_link"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    from_series_id: Mapped[str] = mapped_column(String(50), ForeignKey("index_series.id"))
    to_series_id: Mapped[str] = mapped_column(String(50), ForeignKey("index_series.id"))
    coefficient: Mapped[float] = mapped_column(Numeric(18, 8))
    reference_period: Mapped[date] = mapped_column(Date)
    source: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
