from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class FamilyMapping(Base):
    __tablename__ = "family_mapping"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    cpv_pattern: Mapped[str] = mapped_column(String(20))
    family: Mapped[str] = mapped_column(String(50))
    strength: Mapped[str] = mapped_column(String(20), comment="strong|medium|weak")
    mapping_note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
