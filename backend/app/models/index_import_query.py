import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class IndexImportQuery(Base):
    """Query SDMX salvata automaticamente dopo un import riuscito.

    Una riga per URL normalizzata: i run successivi riusano la stessa riga
    aggiornando `last_run_at`. Le serie toccate sono collegate nella tabella
    `index_import_query_series`.
    """

    __tablename__ = "index_import_query"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    url: Mapped[str] = mapped_column(Text)
    dataflow_id: Mapped[str] = mapped_column(String(100))
    key_part: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    end_period_strategy: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="last_month_end", default="last_month_end"
    )
    start_period_strategy: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="fixed", default="fixed"
    )

class IndexImportQuerySeries(Base):
    """Link N-N tra query salvata e serie toccate dall'import."""

    __tablename__ = "index_import_query_series"
    __table_args__ = (
        UniqueConstraint("query_id", "series_id", name="uq_query_series"),
    )

    query_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("index_import_query.id", ondelete="CASCADE"),
        primary_key=True,
    )
    series_id: Mapped[str] = mapped_column(
        String(50),
        ForeignKey("index_series.id", ondelete="CASCADE"),
        primary_key=True,
    )