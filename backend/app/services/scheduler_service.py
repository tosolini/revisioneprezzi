"""Servizio scheduler per aggiornamento indici e generazione cicli."""

from __future__ import annotations

import os
from datetime import date, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.contract_context import ContractContext
from app.models.revision_cycle import RevisionCycle
from app.models.revision_plan import RevisionPlan
from app.models.scheduler_run import SchedulerRun
from app.services.revision_calculation_v2 import get_strict_index_observation
from app.services.revision_plan_service import (
    ensure_cycles,
    is_plan_ready,
)

try:
    from app.services.indices_import import import_sdmx_content as _import_sdmx_content
except Exception:  # pragma: no cover
    _import_sdmx_content = None


def _token_ok(header_token: str | None) -> bool:
    expected = os.getenv("SCHEDULER_TOKEN")
    if not expected:
        return False
    return header_token == expected


def acquire_lock(db: Session) -> bool:
    res = db.execute(text("SELECT pg_try_advisory_lock(hashtext('revprezzi_scheduler'))")).scalar()
    return bool(res)


def release_lock(db: Session) -> None:
    db.execute(text("SELECT pg_advisory_unlock(hashtext('revprezzi_scheduler'))"))
    db.commit()


def run_due(db: Session, trigger: str = "manual") -> dict[str, Any]:
    run = SchedulerRun(trigger=trigger, status="running")
    db.add(run)
    db.commit()
    db.refresh(run)

    plans_evaluated = 0
    cycles_created = 0
    queries_run = 0
    queries_failed = 0
    details: list[dict] = []

    try:
        if not acquire_lock(db):
            run.status = "failed"
            run.error_text = "lock non acquisito"
            db.commit()
            return {"run_id": str(run.id), "status": "locked"}

        plans = db.query(RevisionPlan).filter(RevisionPlan.status == "active").all()
        for plan in plans:
            plans_evaluated += 1
            ctx = db.query(ContractContext).filter(ContractContext.case_id == plan.case_id).first()
            contract_end = ctx.contract_end_date if ctx else None

            # generate future cycles
            before = db.query(RevisionCycle).filter(RevisionCycle.plan_id == plan.id).count()
            ensure_cycles(db, plan, contract_end)
            db.commit()
            after = db.query(RevisionCycle).filter(RevisionCycle.plan_id == plan.id).count()
            cycles_created += max(0, after - before)

            ready, rd = is_plan_ready(db, plan)
            blocking_series = [r["series_id"] for r in rd if r["blocking"]]

            # find due cycles
            today = date.today()
            due_cycles = (
                db.query(RevisionCycle)
                .filter(RevisionCycle.plan_id == plan.id)
                .filter(RevisionCycle.status.in_(["planned", "waiting_data", "ready"]))
                .filter(RevisionCycle.comparison_period <= today)
                .all()
            )

            for cyc in due_cycles:
                if not ready:
                    cyc.status = "waiting_data"
                    details.append(
                        {
                            "plan": str(plan.id),
                            "cycle": str(cyc.id),
                            "reason": "missing_sdmx_query",
                            "series": blocking_series,
                        }
                    )
                    db.commit()
                    continue

                # strict data check
                components = {s.series_id: s.weight for s in plan.series}
                freq_map = {s.series_id: s.frequency for s in plan.series}
                data_ok = True
                missing: list[str] = []
                for sid in components:
                    freq = freq_map.get(sid)
                    base = get_strict_index_observation(db, sid, cyc.base_period, freq)
                    comp = get_strict_index_observation(db, sid, cyc.comparison_period, freq)
                    if base is None or comp is None:
                        data_ok = False
                        missing.append(sid)

                if not data_ok:
                    # incremental refresh: dedup by query id
                    from app.models.index_import_query import (
                        IndexImportQuery,
                        IndexImportQuerySeries,
                    )

                    series_ids = [s.series_id for s in plan.series]
                    links = (
                        db.query(IndexImportQuerySeries, IndexImportQuery)
                        .join(
                            IndexImportQuery, IndexImportQuerySeries.query_id == IndexImportQuery.id
                        )
                        .filter(IndexImportQuerySeries.series_id.in_(series_ids))
                        .all()
                    )
                    unique_queries = {}
                    for link, q in links:
                        unique_queries.setdefault(str(q.id), q)

                    for qid, q in unique_queries.items():
                        try:
                            url = q.url
                            # rewrite periods

                            # Riesegue la query salvata così com'è (upsert idempotente).
                            # Se end_period_strategy=fixed non arriveranno dati nuovi;
                            # l'avviso è gestito dalla readiness.
                            _import_sdmx_content(url, db, group_key="", freq_param="")
                            queries_run += 1
                        except Exception as e:
                            queries_failed += 1
                            details.append({"query": qid, "error": str(e)})

                    # re-check
                    data_ok2 = True
                    for sid in components:
                        freq = freq_map.get(sid)
                        base = get_strict_index_observation(db, sid, cyc.base_period, freq)
                        comp = get_strict_index_observation(db, sid, cyc.comparison_period, freq)
                        if base is None or comp is None:
                            data_ok2 = False
                    data_ok = data_ok2

                if data_ok:
                    cyc.status = "ready"
                    cyc.data_ready_at = datetime.utcnow()
                else:
                    cyc.status = "waiting_data"
                details.append({"plan": str(plan.id), "cycle": str(cyc.id), "status": cyc.status})
                db.commit()

            # update next_comparison_period
            future = sorted(
                c.comparison_period
                for c in plan.cycles
                if c.status in ("planned", "waiting_data", "ready")
            )
            plan.next_comparison_period = future[0] if future else None
            db.commit()

        run.status = "success" if queries_failed == 0 else "partial"
    except Exception as e:
        run.status = "failed"
        run.error_text = str(e)
    finally:
        try:
            release_lock(db)
        except Exception:
            pass
        run.finished_at = datetime.utcnow()
        run.plans_evaluated = plans_evaluated
        run.cycles_created = cycles_created
        run.queries_run = queries_run
        run.queries_failed = queries_failed
        run.details_json = {"items": details}
        db.commit()

    return {
        "run_id": str(run.id),
        "status": run.status,
        "plans_evaluated": plans_evaluated,
        "cycles_created": cycles_created,
        "queries_run": queries_run,
        "queries_failed": queries_failed,
    }


def get_run(db: Session, run_id: str) -> SchedulerRun | None:
    try:
        rid = __import__("uuid").UUID(run_id)
    except ValueError:
        return None
    return db.query(SchedulerRun).filter(SchedulerRun.id == rid).first()
