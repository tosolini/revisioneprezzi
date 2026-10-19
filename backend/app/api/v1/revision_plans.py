"""API per piani di revisione prezzi ricorrenti e cicli."""

from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.case_file import CaseFile
from app.models.revision_cycle import RevisionCycle
from app.models.revision_plan import RevisionPlan
from app.models.revision_result import RevisionResult
from app.models.index_series import IndexSeries
from app.services import revision_plan_service as svc
from app.services.audit_service import log_event as log_audit

router = APIRouter(tags=["revision-plans"])


def _case_or_404(db: Session, case_id: str) -> CaseFile:
    try:
        cid = uuid.UUID(case_id)
    except ValueError:
        raise HTTPException(400, "case_id non valido")
    case = db.query(CaseFile).filter(CaseFile.id == cid).first()
    if not case:
        raise HTTPException(404, "pratica non trovata")
    return case


class SeriesIn(BaseModel):
    series_id: str
    weight: float
    frequency: str | None = None
    base_year: int | None = None
    sdmx_query_id: str | None = None


class PlanIn(BaseModel):
    frequency: str
    anchor_period: date
    first_comparison_period: date | None = None
    next_comparison_period: date | None = None
    amount_policy: str = "period"
    auto_generate: bool = True
    lead_days: int = 0
    status: str = "draft"
    series: list[SeriesIn] = []


class ApproveIn(BaseModel):
    approved_by: str


class ReopenIn(BaseModel):
    motivation: str


class VoidIn(BaseModel):
    reason: str


def _plan_to_dict(plan: RevisionPlan, db: Session) -> dict:
    rd = svc.plan_readiness(db, plan)
    return {
        "id": str(plan.id),
        "case_id": str(plan.case_id),
        "frequency": plan.frequency,
        "anchor_period": plan.anchor_period.isoformat(),
        "first_comparison_period": plan.first_comparison_period.isoformat(),
        "next_comparison_period": plan.next_comparison_period.isoformat()
        if plan.next_comparison_period
        else None,
        "amount_policy": plan.amount_policy,
        "auto_generate": plan.auto_generate,
        "lead_days": plan.lead_days,
        "status": plan.status,
        "plan_version": plan.plan_version,
        "readiness_checked_at": plan.readiness_checked_at.isoformat()
        if plan.readiness_checked_at
        else None,
        "series": [
            {
                "series_id": s.series_id,
                "weight": s.weight,
                "frequency": s.frequency,
                "base_year": s.base_year,
                "sdmx_query_id": str(s.sdmx_query_id) if s.sdmx_query_id else None,
            }
            for s in plan.series
        ],
        "readiness": rd,
        "ready": all(not r["blocking"] for r in rd),
    }


def _cycle_to_dict(c: RevisionCycle, db: Session | None = None) -> dict:
    variation = None
    revision_amount = None
    if c.result_id:
        try:
            rr = None
            if db is not None:
                rr = db.query(RevisionResult).filter(RevisionResult.id == c.result_id).first()
            if rr is not None:
                variation = rr.variation_percent
                revision_amount = rr.revision_amount
        except Exception:
            pass
    return {
        "id": str(c.id),
        "plan_id": str(c.plan_id),
        "case_id": str(c.case_id),
        "sequence_no": c.sequence_no,
        "base_period": c.base_period.isoformat(),
        "comparison_period": c.comparison_period.isoformat(),
        "amount": c.amount,
        "status": c.status,
        "result_id": str(c.result_id) if c.result_id else None,
        "variation_percent": variation,
        "revision_amount": revision_amount,
        "snapshot_hash": c.snapshot_hash,
        "data_ready_at": c.data_ready_at.isoformat() if c.data_ready_at else None,
        "calculated_at": c.calculated_at.isoformat() if c.calculated_at else None,
        "approved_at": c.approved_at.isoformat() if c.approved_at else None,
        "approved_by": c.approved_by,
        "void_reason": c.void_reason,
    }


@router.get("/cases/{case_id}/revision-plan")
def get_plan(case_id: str, db: Session = Depends(get_db)):
    _case_or_404(db, case_id)
    plan = svc.get_plan(db, case_id)
    if not plan:
        return {"plan": None}
    # Crea i cicli se mancano (es. piani bozza o pre-attivazione)
    if not plan.cycles:
        from app.models.contract_context import ContractContext

        ctx = db.query(ContractContext).filter(ContractContext.case_id == plan.case_id).first()
        contract_end = ctx.contract_end_date if ctx else None
        svc.ensure_cycles(db, plan, contract_end)
        db.commit()
        db.refresh(plan)
    return {"plan": _plan_to_dict(plan, db)}


@router.put("/cases/{case_id}/revision-plan")
def upsert_plan(case_id: str, payload: PlanIn, db: Session = Depends(get_db)):
    case = _case_or_404(db, case_id)
    # validate frequency
    if payload.frequency not in ("monthly", "quarterly", "semiannual", "annual"):
        raise HTTPException(400, "frequenza non ammessa")
    if not payload.series:
        raise HTTPException(400, "almeno una serie richiesta")
    anchor = payload.anchor_period
    first = payload.first_comparison_period or svc._add_months(
        anchor, svc.FREQ_MONTHS[payload.frequency]
    )
    data = {
        "frequency": payload.frequency,
        "anchor_period": anchor,
        "first_comparison_period": first,
        "next_comparison_period": payload.next_comparison_period or first,
        "amount_policy": payload.amount_policy,
        "auto_generate": payload.auto_generate,
        "lead_days": payload.lead_days,
        "status": payload.status,
        "series": [s.model_dump() for s in payload.series],
    }
    # convert sdmx_query_id str->uuid handled in service? service passes through; convert here
    for s in data["series"]:
        if s.get("sdmx_query_id"):
            s["sdmx_query_id"] = uuid.UUID(s["sdmx_query_id"])
    plan = svc.create_or_update_plan(db, case_id, data)
    log_audit(db, "revision_plan.upserted", case_id=case.id, user_id=None)
    return {"plan": _plan_to_dict(plan, db)}


@router.get("/cases/{case_id}/revision-plan/readiness")
def readiness(case_id: str, db: Session = Depends(get_db)):
    _case_or_404(db, case_id)
    plan = svc.get_plan(db, case_id)
    if not plan:
        raise HTTPException(404, "piano non trovato")
    rd = svc.plan_readiness(db, plan)
    return {"ready": all(not r["blocking"] for r in rd), "series": rd}


@router.post("/cases/{case_id}/revision-plan/activate")
def activate(case_id: str, db: Session = Depends(get_db)):
    _case_or_404(db, case_id)
    plan = svc.get_plan(db, case_id)
    if not plan:
        raise HTTPException(404, "piano non trovato")
    from app.models.contract_context import ContractContext

    ctx = db.query(ContractContext).filter(ContractContext.case_id == plan.case_id).first()
    contract_end = ctx.contract_end_date if ctx else None
    ready, rd = svc.activate_plan(db, plan, contract_end=contract_end)
    log_audit(db, "revision_plan.activated", case_id=plan.case_id, user_id=None)
    return {"plan": _plan_to_dict(plan, db), "ready": ready, "readiness": rd}


@router.post("/cases/{case_id}/revision-plan/pause")
def pause(case_id: str, db: Session = Depends(get_db)):
    _case_or_404(db, case_id)
    plan = svc.get_plan(db, case_id)
    if not plan:
        raise HTTPException(404, "piano non trovato")
    plan.status = "paused"
    db.commit()
    return {"plan": _plan_to_dict(plan, db)}


@router.post("/cases/{case_id}/revision-plan/close")
def close(case_id: str, db: Session = Depends(get_db)):
    _case_or_404(db, case_id)
    plan = svc.get_plan(db, case_id)
    if not plan:
        raise HTTPException(404, "piano non trovato")
    plan.status = "closed"
    db.commit()
    return {"plan": _plan_to_dict(plan, db)}


@router.get("/cases/{case_id}/cycles")
def list_cycles(case_id: str, db: Session = Depends(get_db)):
    _case_or_404(db, case_id)
    plan = svc.get_plan(db, case_id)
    if not plan:
        return {"cycles": []}
    cycles = (
        db.query(RevisionCycle)
        .filter(RevisionCycle.plan_id == plan.id)
        .order_by(RevisionCycle.sequence_no)
        .all()
    )
    return {"cycles": [_cycle_to_dict(c, db) for c in cycles]}


@router.post("/cases/{case_id}/cycles/{cycle_id}/calculate")
def calculate_cycle(case_id: str, cycle_id: str, payload: dict, db: Session = Depends(get_db)):
    _case_or_404(db, case_id)
    try:
        cid = uuid.UUID(cycle_id)
    except ValueError:
        raise HTTPException(400, "cycle_id non valido")
    cycle = db.query(RevisionCycle).filter(RevisionCycle.id == cid).first()
    if not cycle:
        raise HTTPException(404, "ciclo non trovato")
    amount = payload.get("amount")
    try:
        res = svc.calculate_cycle(db, cycle, amount=amount)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return res


@router.post("/cases/{case_id}/cycles/{cycle_id}/approve")
def approve_cycle(case_id: str, cycle_id: str, payload: ApproveIn, db: Session = Depends(get_db)):
    _case_or_404(db, case_id)
    try:
        cid = uuid.UUID(cycle_id)
    except ValueError:
        raise HTTPException(400, "cycle_id non valido")
    cycle = db.query(RevisionCycle).filter(RevisionCycle.id == cid).first()
    if not cycle:
        raise HTTPException(404, "ciclo non trovato")
    try:
        svc.approve_cycle(db, cycle, payload.approved_by)
    except ValueError as e:
        raise HTTPException(400, str(e))
    log_audit(db, "revision_cycle.approved", case_id=cycle.case_id, user_id=payload.approved_by)
    return {"cycle": _cycle_to_dict(cycle, db)}


@router.post("/cases/{case_id}/cycles/{cycle_id}/reopen")
def reopen_cycle(case_id: str, cycle_id: str, payload: ReopenIn, db: Session = Depends(get_db)):
    _case_or_404(db, case_id)
    try:
        cid = uuid.UUID(cycle_id)
    except ValueError:
        raise HTTPException(400, "cycle_id non valido")
    cycle = db.query(RevisionCycle).filter(RevisionCycle.id == cid).first()
    if not cycle:
        raise HTTPException(404, "ciclo non trovato")
    try:
        svc.reopen_cycle(db, cycle, payload.motivation)
    except ValueError as e:
        raise HTTPException(400, str(e))
    log_audit(
        db,
        "revision_cycle.reopened",
        case_id=cycle.case_id,
        user_id=None,
        motivation=payload.motivation,
    )
    return {"cycle": _cycle_to_dict(cycle, db)}


class RecalcAllIn(BaseModel):
    amount: float | None = None


@router.post("/cases/{case_id}/cycles/recalculate-all")
def recalculate_all(case_id: str, payload: RecalcAllIn, db: Session = Depends(get_db)):
    _case_or_404(db, case_id)
    default_amount = payload.amount
    if default_amount is None:
        try:
            from app.models.contract_context import ContractContext

            ctx = (
                db.query(ContractContext)
                .filter(ContractContext.case_id == uuid.UUID(case_id))
                .first()
            )
            if ctx is not None and ctx.amount_subject_to_revision:
                default_amount = float(ctx.amount_subject_to_revision)
        except (ValueError, TypeError, Exception):
            default_amount = None
    res = svc.recalculate_all_cycles(db, uuid.UUID(case_id), default_amount=default_amount)
    return res


@router.post("/cases/{case_id}/cycles/{cycle_id}/void")
def void_cycle(case_id: str, cycle_id: str, payload: VoidIn, db: Session = Depends(get_db)):
    _case_or_404(db, case_id)
    try:
        cid = uuid.UUID(cycle_id)
    except ValueError:
        raise HTTPException(400, "cycle_id non valido")
    cycle = db.query(RevisionCycle).filter(RevisionCycle.id == cid).first()
    if not cycle:
        raise HTTPException(404, "ciclo non trovato")
    svc.void_cycle(db, cycle, payload.reason)
    log_audit(
        db, "revision_cycle.voided", case_id=cycle.case_id, user_id=None, motivation=payload.reason
    )
    return {"cycle": _cycle_to_dict(cycle, db)}


@router.get("/indices/missing-queries")
def missing_queries(classification_ref: str | None = None, db: Session = Depends(get_db)):
    q = db.query(IndexSeries)
    if classification_ref:
        q = q.filter(IndexSeries.classification_ref == classification_ref)
    series = q.all()
    latest = svc._latest_saved_queries(db, [s.id for s in series])
    out = []
    for s in series:
        if s.id not in latest:
            from app.services.sdmx_backfill import build_sdmx_url

            out.append(
                {
                    "series_id": s.id,
                    "name": s.name,
                    "classification_ref": s.classification_ref,
                    "frequency": s.frequency,
                    "mappable": build_sdmx_url(s) is not None,
                    "suggested_url": build_sdmx_url(s),
                }
            )
    return {"series": out, "count": len(out)}


@router.get("/indices/{series_id}/suggested-query")
def suggested_query(series_id: str, db: Session = Depends(get_db)):
    row = db.query(IndexSeries).filter(IndexSeries.id == series_id).first()
    if not row:
        raise HTTPException(404, "serie non trovata")
    from app.services.sdmx_backfill import build_sdmx_url

    url = build_sdmx_url(row)
    return {"series_id": series_id, "url": url, "mappable": url is not None}
