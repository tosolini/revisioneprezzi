import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class ClassificationDecision(Base):
    __tablename__ = "classification_decision"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    case_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("case_file.id"), unique=True
    )
    selected_family: Mapped[str | None] = mapped_column(String(100))
    candidate_families_json: Mapped[str | None] = mapped_column(
        Text, comment="JSON array of candidates"
    )
    selected_index_series_id: Mapped[str | None] = mapped_column(String(50))
    classification_confidence: Mapped[str | None] = mapped_column(
        String(20), comment="high|medium|low"
    )
    manual_override: Mapped[bool] = mapped_column(Boolean, default=False)
    override_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    case_file = relationship("CaseFile", back_populates="classification_decision")
