import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class ContractContext(Base):
    __tablename__ = "contract_context"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    case_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("case_file.id"), unique=True
    )
    contract_type: Mapped[str | None] = mapped_column(
        String(50), comment="works|service|supply|mixed"
    )
    is_duration_contract: Mapped[bool | None] = mapped_column(Boolean)
    instant_execution: Mapped[bool | None] = mapped_column(Boolean)
    stipulation_date: Mapped[date | None] = mapped_column(Date)
    execution_start_date: Mapped[date | None] = mapped_column(Date)
    duration_months: Mapped[int | None] = mapped_column()
    contract_amount_total: Mapped[float | None] = mapped_column(Float)
    amount_subject_to_revision: Mapped[float | None] = mapped_column(Float)
    notes: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    case_file = relationship("CaseFile", back_populates="contract_context")
