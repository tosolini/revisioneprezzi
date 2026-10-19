"""API scheduler."""

from __future__ import annotations

import os

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.scheduler_service import get_run, run_due

router = APIRouter(tags=["scheduler"])


@router.post("/scheduler/run-due")
def run_due_endpoint(
    x_scheduler_token: str | None = Header(default=None, alias="X-Scheduler-Token"),
    db: Session = Depends(get_db),
):
    expected = os.getenv("SCHEDULER_TOKEN")
    if not expected or x_scheduler_token != expected:
        raise HTTPException(401, "token non valido o non configurato")
    return run_due(db, trigger="manual")


@router.get("/scheduler/runs/{run_id}")
def get_run_endpoint(run_id: str, db: Session = Depends(get_db)):
    run = get_run(db, run_id)
    if not run:
        raise HTTPException(404, "run non trovato")
    return {
        "id": str(run.id),
        "trigger": run.trigger,
        "started_at": run.started_at.isoformat(),
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
        "status": run.status,
        "plans_evaluated": run.plans_evaluated,
        "cycles_created": run.cycles_created,
        "queries_run": run.queries_run,
        "queries_failed": run.queries_failed,
        "details": run.details_json,
        "error": run.error_text,
    }