import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class RevisionResult(Base):
    __tablename__ = "revision_result"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    case_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("case_file.id")
    )
    base_value: Mapped[float | None] = mapped_column(Float)
    comparison_value: Mapped[float | None] = mapped_column(Float)
    variation_percent: Mapped[float | None] = mapped_column(Float)
    threshold_percent: Mapped[float | None] = mapped_column(Float)
    excess_percent: Mapped[float | None] = mapped_column(Float)
    recognition_percent: Mapped[float | None] = mapped_column(Float)
    revision_amount: Mapped[float | None] = mapped_column(Float)
    formula_detail: Mapped[str | None] = mapped_column(
        Text, comment="human-readable formula applied"
    )
    result_version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    case_file = relationship("CaseFile", back_populates="revision_results")
