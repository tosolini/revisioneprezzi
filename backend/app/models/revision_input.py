import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class RevisionInput(Base):
    __tablename__ = "revision_input"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    case_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("case_file.id"), unique=True
    )
    base_period: Mapped[date | None] = mapped_column(Date)
    comparison_period: Mapped[date | None] = mapped_column(Date)
    amount_subject_to_revision: Mapped[float | None] = mapped_column(Float)
    excluded_amount: Mapped[float | None] = mapped_column(Float)
    exclusion_reason: Mapped[str | None] = mapped_column(Text)
    composite_weights_json: Mapped[str | None] = mapped_column(
        Text, comment="JSON weights for multi-index"
    )
    notes: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    case_file = relationship("CaseFile", back_populates="revision_input")
