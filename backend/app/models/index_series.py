from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class IndexSeries(Base):
    __tablename__ = "index_series"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    source: Mapped[str] = mapped_column(String(100))
    normative_category: Mapped[str | None] = mapped_column(String(100))
    classification_ref: Mapped[str | None] = mapped_column(
        String(100), comment="ATECO/ECOICOP reference"
    )
    frequency: Mapped[str | None] = mapped_column(
        String(20), comment="monthly|quarterly|yearly"
    )
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    observations = relationship("IndexObservation", back_populates="series")
