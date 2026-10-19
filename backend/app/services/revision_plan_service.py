"""Servizio per piani di revisione prezzi ricorrenti e cicli."""

from __future__ import annotations

import hashlib
import json
from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models.index_import_query import IndexImportQuery, IndexImportQuerySeries
from app.models.index_series import IndexSeries
from app.models.revision_cycle import RevisionCycle
from app.models.revision_plan import RevisionPlan, RevisionPlanSeries
from app.models.revision_result import RevisionResult
from app.services.revision_calculation_v2 import (
    calculate_price_revision,
    get_strict_index_observation,
)
from app.services.sdmx_backfill import build_sdmx_url

FREQ_MONTHS = {"monthly": 1, "quarterly": 3, "semiannual": 6, "annual": 12}
MAX_CYCLES = 240


def _add_months(d: date, months: int) -> date:
    y = d.year + (d.month - 1 + months) // 12
    m = (d.month - 1 + months) % 12 + 1
    # day clamp
    import calendar

    day = min(d.day, calendar.monthrange(y, m)[1])
    return date(y, m, day)


def generate_comparison_periods(
    anchor: date, frequency: str, contract_end: date | None
) -> list[date]:
    step = FREQ_MONTHS[frequency]
    periods: list[date] = []
    cur = _add_months(anchor, step)
    limit = contract_end or _add_months(anchor, step * MAX_CYCLES)
    while cur <= limit and len(periods) < MAX_CYCLES:
        periods.append(cur)
        cur = _add_months(cur, step)
    if not periods:
        periods.append(_add_months(anchor, step))
    return periods


def _latest_saved_queries(db: Session, series_ids: list[str]) -> dict[str, IndexImportQuery]:
    if not series_ids:
        return {}
    links = (
        db.query(IndexImportQuerySeries, IndexImportQuery)
        .join(IndexImportQuery, IndexImportQuerySeries.query_id == IndexImportQuery.id)
        .filter(IndexImportQuerySeries.series_id.in_(series_ids))
        .order_by(IndexImportQuery.created_at.desc(), IndexImportQuery.last_run_at.desc())
        .all()
    )
    latest: dict[str, IndexImportQuery] = {}
    for link, q in links:
        latest.setdefault(link.series_id, q)
    return latest


def plan_readiness(db: Session, plan: RevisionPlan) -> list[dict]:
    series_ids = [s.series_id for s in plan.series]
    latest = _latest_saved_queries(db, series_ids)
    series_rows = {
        s.id: s for s in db.query(IndexSeries).filter(IndexSeries.id.in_(series_ids)).all()
    }
    out: list[dict] = []
    for ps in plan.series:
        q = latest.get(ps.series_id)
        row = series_rows.get(ps.series_id)
        if q is None:
            suggested = build_sdmx_url(row) if row else None
            status = "missing_query" if suggested else "not_mappable"
            out.append(
                {
                    "series_id": ps.series_id,
                    "name": row.name if row else ps.series_id,
                    "weight": ps.weight,
                    "frequency": ps.frequency or (row.frequency if row else None),
                    "base_year": ps.base_year,
                    "status": status,
                    "query_id": None,
                    "last_run_at": None,
                    "end_period_strategy": None,
                    "suggested_url": suggested,
                    "blocking": True,
                    "warning": None,
                }
            )
        else:
            warning = None
            if getattr(q, "end_period_strategy", None) == "fixed":
                warning = (
                    "end_period_strategy=fixed: lo scheduler usa "
                    "comunque una finestra incrementale propria"
                )
            out.append(
                {
                    "series_id": ps.series_id,
                    "name": row.name if row else ps.series_id,
                    "weight": ps.weight,
                    "frequency": ps.frequency or (row.frequency if row else None),
                    "base_year": ps.base_year,
                    "status": "ready",
                    "query_id": str(q.id),
                    "last_run_at": q.last_run_at.isoformat() if q.last_run_at else None,
                    "end_period_strategy": getattr(q, "end_period_strategy", None),
                    "suggested_url": None,
                    "blocking": False,
                    "warning": warning,
                }
            )
    return out


def is_plan_ready(db: Session, plan: RevisionPlan) -> tuple[bool, list[dict]]:
    rd = plan_readiness(db, plan)
    blocking = [r for r in rd if r["blocking"]]
    return len(blocking) == 0, rd


def create_or_update_plan(
    db: Session,
    case_id: str,
    payload: dict,
) -> RevisionPlan:
    plan = db.query(RevisionPlan).filter(RevisionPlan.case_id == case_id).first()
    if plan is None:
        plan = RevisionPlan(case_id=case_id)
        db.add(plan)
    plan.frequency = payload["frequency"]
    plan.anchor_period = payload["anchor_period"]
    plan.first_comparison_period = payload["first_comparison_period"]
    plan.next_comparison_period = (
        payload.get("next_comparison_period") or payload["first_comparison_period"]
    )
    plan.amount_policy = payload.get("amount_policy", "period")
    plan.auto_generate = payload.get("auto_generate", True)
    plan.lead_days = payload.get("lead_days", 0)
    plan.status = payload.get("status", plan.status or "draft")
    # replace series
    plan.series.clear()
    db.flush()
    for s in payload.get("series", []):
        ps = RevisionPlanSeries(
            plan_id=plan.id,
            series_id=s["series_id"],
            weight=s["weight"],
            frequency=s.get("frequency"),
            base_year=s.get("base_year"),
            sdmx_query_id=s.get("sdmx_query_id"),
        )
        db.add(ps)
    db.commit()
    db.refresh(plan)
    return plan


def get_plan(db: Session, case_id: str) -> RevisionPlan | None:
    return db.query(RevisionPlan).filter(RevisionPlan.case_id == case_id).first()


def activate_plan(
    db: Session, plan: RevisionPlan, contract_end: date | None = None
) -> tuple[bool, list[dict]]:
    ready, rd = is_plan_ready(db, plan)
    plan.status = "active"
    plan.readiness_checked_at = datetime.utcnow()
    # ensure cycles exist even if scheduling is degraded (missing queries)
    ensure_cycles(db, plan, contract_end)
    db.commit()
    db.refresh(plan)
    return ready, rd


def ensure_cycles(
    db: Session, plan: RevisionPlan, contract_end: date | None = None
) -> list[RevisionCycle]:
    existing = {c.comparison_period for c in plan.cycles}
    periods = generate_comparison_periods(plan.anchor_period, plan.frequency, contract_end)
    created: list[RevisionCycle] = []
    seq = len(plan.cycles) + 1
    for p in periods:
        if p in existing:
            continue
        cyc = RevisionCycle(
            plan_id=plan.id,
            case_id=plan.case_id,
            sequence_no=seq,
            base_period=plan.anchor_period,
            comparison_period=p,
            status="planned",
        )
        db.add(cyc)
        created.append(cyc)
        seq += 1
    if created:
        db.flush()
    # set next_comparison_period
    future = sorted(
        c.comparison_period for c in plan.cycles if c.status in ("planned", "waiting_data", "ready")
    )
    plan.next_comparison_period = future[0] if future else None
    return created


def cycle_strict_check(
    db: Session, cycle: RevisionCycle, indices_config: dict[str, Any]
) -> tuple[bool, str | None]:
    # build components from plan series
    components = {s.series_id: s.weight for s in cycle.plan.series}
    # determine frequency per series
    freq_map = {s.series_id: s.frequency for s in cycle.plan.series}
    for sid, w in components.items():
        freq = freq_map.get(sid)
        base = get_strict_index_observation(db, sid, cycle.base_period, freq)
        comp = get_strict_index_observation(db, sid, cycle.comparison_period, freq)
        if base is None or comp is None:
            return False, f"missing_data:{sid}"
    return True, None


def calculate_cycle(
    db: Session,
    cycle: RevisionCycle,
    amount: float | None = None,
    indices_config: dict | None = None,
) -> dict:
    if amount is not None:
        cycle.amount = amount
    if cycle.amount is None:
        raise ValueError("amount required")
    # build indices_config from plan series
    components = {s.series_id: s.weight for s in cycle.plan.series}
    cfg = {"type": "composite", "method": "weighted_average", "components": components}
    # strict check first
    ok, reason = cycle_strict_check(db, cycle, cfg)
    if not ok:
        cycle.status = "waiting_data"
        db.commit()
        return {"status": "waiting_data", "reason": reason}
    result = calculate_price_revision(
        db=db,
        contract_type=_contract_type_for_case(db, cycle.case_id),
        amount=cycle.amount,
        base_period=cycle.base_period,
        comparison_period=cycle.comparison_period,
        indices_config=cfg,
    )
    if "error" in result:
        cycle.status = "waiting_data"
        db.commit()
        return {"status": "waiting_data", "reason": result["error"]}
    # save RevisionResult linked to cycle
    rr = RevisionResult(
        case_id=cycle.case_id,
        cycle_id=cycle.id,
        base_value=result.get("base_value"),
        comparison_value=result.get("comparison_value"),
        variation_percent=result.get("variation_percent"),
        threshold_percent=result.get("threshold_percent"),
        excess_percent=result.get("excess_percent"),
        recognition_percent=result.get("recognition_percent"),
        revision_amount=result.get("revision_amount"),
        formula_detail=result.get("formula_detail"),
        result_version=(
            db.query(RevisionResult).filter(RevisionResult.case_id == cycle.case_id).count() + 1
        ),
    )
    db.add(rr)
    db.flush()
    cycle.result_id = rr.id
    cycle.status = "calculated"
    cycle.calculated_at = datetime.utcnow()
    # snapshot
    cycle.snapshot_json = _build_snapshot(cycle, result, cfg)
    cycle.snapshot_hash = _hash_snapshot(cycle.snapshot_json)
    db.commit()
    db.refresh(cycle)
    return {"status": "calculated", "result": result, "cycle_id": str(cycle.id)}


def _contract_type_for_case(db: Session, case_id) -> str:
    # try ContractContext
    from app.models.contract_context import ContractContext

    ctx = db.query(ContractContext).filter(ContractContext.case_id == case_id).first()
    if ctx and ctx.contract_type:
        return ctx.contract_type
    return "services"


def approve_cycle(db: Session, cycle: RevisionCycle, approved_by: str) -> None:
    if cycle.status != "calculated":
        raise ValueError("cycle not calculated")
    cycle.status = "approved"
    cycle.approved_at = datetime.utcnow()
    cycle.approved_by = approved_by
    db.commit()


def reopen_cycle(db: Session, cycle: RevisionCycle, motivation: str) -> None:
    if cycle.status != "approved":
        raise ValueError("cycle not approved")
    cycle.status = "calculated"
    # audit written by caller
    db.commit()


def void_cycle(db: Session, cycle: RevisionCycle, reason: str) -> None:
    cycle.status = "void"
    cycle.void_reason = reason
    db.commit()


def recalculate_all_cycles(db: Session, case_id, default_amount: float | None = None) -> dict:
    """Calcola in blocco i cicli con dati ISTAT disponibili (strict).

    Salta i cicli senza importo e quelli senza dati definitivi.
    Ritorna un riepilogo {calculated, skipped, waiting}.
    """
    plan = db.query(RevisionPlan).filter(RevisionPlan.case_id == case_id).first()
    if not plan:
        return {"calculated": 0, "skipped": 0, "waiting": 0, "error": "no plan"}

    # importo base della pratica
    if default_amount is None:
        try:
            # fallback: nessun importo base noto
            default_amount = None
        except Exception:
            default_amount = None

    cycles = (
        db.query(RevisionCycle)
        .filter(RevisionCycle.plan_id == plan.id)
        .filter(RevisionCycle.status.in_(["planned", "ready", "waiting_data"]))
        .order_by(RevisionCycle.sequence_no)
        .all()
    )

    contract_type = _contract_type_for_case(db, case_id)
    calculated = 0
    skipped = 0
    waiting = 0
    for cyc in cycles:
        amt = cyc.amount if cyc.amount is not None else default_amount
        if amt is None:
            skipped += 1
            continue
        cyc.amount = amt
        cfg = {
            "type": "composite",
            "method": "weighted_average",
            "components": {s.series_id: s.weight for s in plan.series},
        }
        ok, reason = cycle_strict_check(db, cyc, cfg)
        if not ok:
            cyc.status = "waiting_data"
            waiting += 1
            db.commit()
            continue
        try:
            # calculate without re-saving amount issues
            result = calculate_price_revision(
                db=db,
                contract_type=contract_type,
                amount=cyc.amount,
                base_period=cyc.base_period,
                comparison_period=cyc.comparison_period,
                indices_config=cfg,
            )
            if "error" in result:
                cyc.status = "waiting_data"
                waiting += 1
                db.commit()
                continue
            rr = RevisionResult(
                case_id=cyc.case_id,
                cycle_id=cyc.id,
                base_value=result.get("base_value"),
                comparison_value=result.get("comparison_value"),
                variation_percent=result.get("variation_percent"),
                threshold_percent=result.get("threshold_percent"),
                excess_percent=result.get("excess_percent"),
                recognition_percent=result.get("recognition_percent"),
                revision_amount=result.get("revision_amount"),
                formula_detail=result.get("formula_detail"),
                result_version=(
                    db.query(RevisionResult).filter(RevisionResult.case_id == case_id).count() + 1
                ),
            )
            db.add(rr)
            db.flush()
            cyc.result_id = rr.id
            cyc.status = "calculated"
            cyc.calculated_at = datetime.utcnow()
            cyc.snapshot_json = _build_snapshot(cyc, result, cfg)
            cyc.snapshot_hash = _hash_snapshot(cyc.snapshot_json)
            db.commit()
            calculated += 1
        except Exception:
            db.rollback()
            skipped += 1
    return {"calculated": calculated, "skipped": skipped, "waiting": waiting}


def _build_snapshot(cycle: RevisionCycle, result: dict, cfg: dict) -> dict:
    return {
        "schema_version": 1,
        "plan_id": str(cycle.plan_id),
        "plan_version": cycle.plan.plan_version,
        "cycle": {
            "id": str(cycle.id),
            "sequence_no": cycle.sequence_no,
            "base_period": cycle.base_period.isoformat(),
            "comparison_period": cycle.comparison_period.isoformat(),
            "amount": cycle.amount,
            "status": cycle.status,
        },
        "result": result,
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }


def _hash_snapshot(snap: dict) -> str:
    canonical = json.dumps(snap, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode()).hexdigest()
