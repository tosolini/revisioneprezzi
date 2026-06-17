import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class CaseFile(Base):
    __tablename__ = "case_file"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(
        String(50), nullable=False, default="draft"
    )
    current_step: Mapped[int] = mapped_column(default=0)
    created_by: Mapped[str | None] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    contract_context = relationship(
        "ContractContext", back_populates="case_file", uselist=False, cascade="all, delete-orphan"
    )
    cpv_assignments = relationship(
        "CpvAssignment", back_populates="case_file", cascade="all, delete-orphan"
    )
    tol_assignments = relationship(
        "TolAssignment", back_populates="case_file", cascade="all, delete-orphan"
    )
    classification_decision = relationship(
        "ClassificationDecision", back_populates="case_file", uselist=False, cascade="all, delete-orphan"
    )
    revision_input = relationship(
        "RevisionInput", back_populates="case_file", uselist=False, cascade="all, delete-orphan"
    )
    revision_results = relationship(
        "RevisionResult", back_populates="case_file", cascade="all, delete-orphan"
    )
    wizard_answers = relationship(
        "WizardAnswer", back_populates="case_file", cascade="all, delete-orphan"
    )
    override_reasons = relationship(
        "OverrideReason", back_populates="case_file", cascade="all, delete-orphan"
    )
    audit_logs = relationship(
        "AuditLog", back_populates="case_file", cascade="all, delete-orphan"
    )
