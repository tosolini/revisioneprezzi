import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class SchedulerRun(Base):
    __tablename__ = "scheduler_run"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trigger: Mapped[str] = mapped_column(String(20))  # cron|manual
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), default="running"
    )  # running|success|partial|failed
    plans_evaluated: Mapped[int] = mapped_column(Integer, default=0)
    cycles_created: Mapped[int] = mapped_column(Integer, default=0)
    queries_run: Mapped[int] = mapped_column(Integer, default=0)
    queries_failed: Mapped[int] = mapped_column(Integer, default=0)
    details_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error_text: Mapped[str | None] = mapped_column(Text, nullable=True)
