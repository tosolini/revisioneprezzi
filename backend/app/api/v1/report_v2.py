"""
API endpoint per generazione report revisione prezzi v2
Ritorna dati strutturati per sezioni per visualizzazione UI
"""

import json
from uuid import UUID
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.case_file import CaseFile
from app.models.contract_context import ContractContext
from app.models.tol import TolAssignment, TolMaster, TolIndexSeries
from app.models.cpv_assignment import CpvAssignment
from app.models.cpv_catalog import CpvCatalog
from app.models.revision_result import RevisionResult
from app.models.wizard_answer import WizardAnswer
from app.services.revision_calculation_v2 import NORMATIVE_PARAMS

router = APIRouter(prefix="/report/v2", tags=["report-v2"])


class ReportSection(BaseModel):
    """Sezione generica del report"""

    title: str
    data: dict
    order: int


class ReportResponse(BaseModel):
    """Risposta strutturata per report v2"""

    case_id: str
    sections: list[ReportSection]
    calculation_result: Optional[dict] = None
    generated_at: str


@router.get("/cases/{case_id}")
def generate_report_v2(case_id: UUID, db: Session = Depends(get_db)) -> ReportResponse:
    """
    Genera report strutturato per sezioni per wizard v2

    Sezioni ritornate:
    1. Dati Contratto (contract_data)
    2. Classificazione (classification)
    3. Importi e Date (amounts_dates)
    4. Indici ISTAT (indices)
    5. Risultato Calcolo (calculation)
    """
    case = db.query(CaseFile).filter(CaseFile.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    contract = db.query(ContractContext).filter(ContractContext.case_id == case_id).first()

    sections = []

    # Fallback: read ente/cig/cup from wizard step 1 if not in ContractContext
    step1_answers = {
        a.field_key: a.field_value
        for a in db.query(WizardAnswer)
        .filter(WizardAnswer.case_id == case_id, WizardAnswer.step == 1)
        .all()
    }

    # Also read step 2 answers for contract_type from wizard (backup)
    step2_answers = {
        a.field_key: a.field_value
        for a in db.query(WizardAnswer)
        .filter(WizardAnswer.case_id == case_id, WizardAnswer.step == 2)
        .all()
    }
    ct = step2_answers.get("contract_type") or (contract.contract_type if contract else None)

    # Read step 3 answers for object_description and cpv_total_amount
    step3_answers = {
        a.field_key: a.field_value
        for a in db.query(WizardAnswer)
        .filter(WizardAnswer.case_id == case_id, WizardAnswer.step == 3)
        .all()
    }

    # Stato wizard-v2 (step 0): il flusso V2 non scrive risposte step 1-5,
    # tiene tutto nel blob. Fallback per importi/periodi/serie quando mancano.
    v2_state: dict = {}
    v2_state_row = (
        db.query(WizardAnswer)
        .filter(
            WizardAnswer.case_id == case_id,
            WizardAnswer.step == 0,
            WizardAnswer.field_key == "wizard_v2_state",
        )
        .first()
    )
    if v2_state_row and v2_state_row.field_value:
        try:
            parsed_state = json.loads(v2_state_row.field_value)
            if isinstance(parsed_state, dict):
                v2_state = parsed_state
        except (json.JSONDecodeError, TypeError, AttributeError):
            pass  # corrupt saved state: report uses step answers only

    contract_data = {
        "case_number": str(case.id),
        "title": case.title or "Senza titolo",
        "contract_type": ct,
        "contract_type_label": _get_contract_type_label(ct),
        "cig": case.cig or step1_answers.get("cig"),
        "cup": case.cup or step1_answers.get("cup"),
        "station": case.stazione_appaltante or step1_answers.get("ente"),
        "operatore_economico": step1_answers.get("operatore_economico"),
        "created_by": case.created_by,
        "notes": step1_answers.get("notes"),
        "case_notes": case.notes,
        "object_description": step3_answers.get("object_description"),
    }

    sections.append(ReportSection(title="Dati Contratto", data=contract_data, order=1))

    # Read step 5 answers for amounts and periods
    step5_answers = {
        a.field_key: a.field_value
        for a in db.query(WizardAnswer)
        .filter(WizardAnswer.case_id == case_id, WizardAnswer.step == 5)
        .all()
    }
    # Also read step 4 for selected index series
    step4_answers = {
        a.field_key: a.field_value
        for a in db.query(WizardAnswer)
        .filter(WizardAnswer.case_id == case_id, WizardAnswer.step == 4)
        .all()
    }

    total_amount = None
    if contract and contract.contract_amount_total:
        total_amount = float(contract.contract_amount_total)
    if not total_amount:
        total_amount = step3_answers.get("cpv_total_amount") or step2_answers.get(
            "contract_amount_total"
        )
    if not total_amount:
        total_amount = v2_state.get("amount") or None
    if total_amount:
        try:
            total_amount = float(total_amount)
        except (ValueError, TypeError):
            total_amount = None

    # Sezione 2: Classificazione (TOL o CPV)
    classification_data = {}

    if contract and contract.contract_type == "works":
        # Recupera TOL assignments
        tol_assignments = db.query(TolAssignment).filter(TolAssignment.case_id == case_id).all()

        tol_details = []
        for ta in tol_assignments:
            tol_master = db.query(TolMaster).filter(TolMaster.code == ta.tol_code).first()

            # Recupera series_id e indice
            tol_series = (
                db.query(TolIndexSeries).filter(TolIndexSeries.tol_code == ta.tol_code).first()
            )

            amount = (
                (float(ta.weight_percent) / 100.0 * total_amount)
                if total_amount and ta.weight_percent
                else None
            )

            tol_details.append(
                {
                    "code": ta.tol_code,
                    "weight_percent": ta.weight_percent,
                    "description": tol_master.short_description if tol_master else ta.tol_code,
                    "series_id": tol_series.series_id if tol_series else None,
                    "amount": round(amount, 2) if amount is not None else None,
                }
            )

        classification_data = {
            "type": "TOL",
            "items": tol_details,
            "total_weight": sum(t["weight_percent"] for t in tol_details),
            "total_amount": total_amount,
        }
    else:
        # Recupera CPV assignments
        cpv_assignments = db.query(CpvAssignment).filter(CpvAssignment.case_id == case_id).all()

        secondary_weight_sum = sum(
            float(a.weight_percent)
            for a in cpv_assignments
            if not a.is_primary and a.weight_percent
        )

        cpv_details = []
        for cpv in cpv_assignments:
            if cpv.is_primary:
                wt = max(0.0, 100.0 - secondary_weight_sum)
            else:
                wt = float(cpv.weight_percent) if cpv.weight_percent else 0.0

            amount = (wt / 100.0 * total_amount) if total_amount else None

            # Usa descrizione dal catalogo CPV, non quella salvata
            # (che può essere object_description)
            cat = db.query(CpvCatalog).filter(CpvCatalog.cpv_code == cpv.cpv_code).first()
            desc = cat.description if cat else (cpv.description or cpv.cpv_code)

            cpv_details.append(
                {
                    "code": cpv.cpv_code,
                    "description": desc,
                    "weight_percent": wt,
                    "amount": round(amount, 2) if amount is not None else None,
                }
            )

        classification_data = {
            "type": "CPV",
            "items": cpv_details,
            "total_weight": sum(d["weight_percent"] for d in cpv_details),
            "total_amount": total_amount,
        }

    sections.append(ReportSection(title="Classificazione", data=classification_data, order=2))

    # Sezione 3: Importi e Date (fallback al blob V2: il flusso V2 non scrive step 5)
    revisable = step5_answers.get("amount_subject_to_revision") or v2_state.get("amount")
    base_period_val = step5_answers.get("base_period") or v2_state.get("base_period")
    comparison_period_val = step5_answers.get("comparison_period") or v2_state.get(
        "comparison_period"
    )

    amounts_data = {
        "contract_amount": total_amount,
        "revisable_amount": revisable or total_amount,
        "base_period": base_period_val,
        "comparison_period": comparison_period_val,
    }

    sections.append(ReportSection(title="Importi e Date", data=amounts_data, order=3))

    # Sezione 4: Indici ISTAT (incluse serie usate nel confronto: trasparenza legale)
    saved_result = v2_state.get("result") if isinstance(v2_state.get("result"), dict) else None
    v2_indices_cfg = v2_state.get("indices_config") if isinstance(
        v2_state.get("indices_config"), dict
    ) else None
    series_id = step4_answers.get("selected_index_series_id") or (
        v2_indices_cfg.get("single_series_id") if v2_indices_cfg else None
    )
    indices_data: dict = {"synthetic_index_base": None, "synthetic_index_comparison": None}

    if series_id:
        base_period_str = base_period_val
        comp_period_str = comparison_period_val
        for period_str, key in [
            (base_period_str, "synthetic_index_base"),
            (comp_period_str, "synthetic_index_comparison"),
        ]:
            if period_str:
                try:
                    period_date = date.fromisoformat(
                        period_str
                        if "-" in period_str and len(period_str) == 10
                        else f"{period_str}-01"
                    )
                    from app.services.revision_calculation_v2 import _get_index_value

                    val = _get_index_value(db, series_id, period_date)
                    if val is not None:
                        indices_data[key] = val
                except ValueError:
                    pass  # malformed period string: omit synthetic index for this period
    if indices_data["synthetic_index_base"] is None and saved_result:
        indices_data["synthetic_index_base"] = saved_result.get("base_value")
    if indices_data["synthetic_index_comparison"] is None and saved_result:
        indices_data["synthetic_index_comparison"] = saved_result.get("comparison_value")

    # Ultimo risultato salvato: fonte primaria delle serie effettivamente usate
    calc_result_row = (
        db.query(RevisionResult)
        .filter(RevisionResult.case_id == case_id)
        .order_by(RevisionResult.created_at.desc())
        .first()
    )
    try:
        detail = calc_result_row.formula_detail if calc_result_row else None
        formula_steps = json.loads(detail or "[]")
        if not isinstance(formula_steps, list):
            formula_steps = []
    except (json.JSONDecodeError, TypeError, AttributeError):
        formula_steps = []

    # saved_result già estratto dal blob V2 sopra; qui solo evidenza serie

    indices_data.update(_extract_series_evidence(formula_steps, saved_result, series_id))
    sections.append(ReportSection(title="Indici ISTAT", data=indices_data, order=4))

    # Sezione 5: Parametri Normativi
    raw_ct = step2_answers.get("contract_type") or (contract.contract_type if contract else None)
    # Normalize: wizard stores "service"/"supply" but NORMATIVE_PARAMS uses "services"/"supplies"
    CT_NORMALIZE = {
        "service": "services",
        "supply": "supplies",
        "works": "works",
        "services": "services",
        "supplies": "supplies",
        "mixed": "mixed",
    }
    contract_type = CT_NORMALIZE.get(raw_ct) if raw_ct else None
    normative_params = {}
    if contract_type:
        params = NORMATIVE_PARAMS.get(contract_type, {})
        normative_params = {
            "threshold_percent": params.get("threshold_percent"),
            "recognition_rate_percent": params.get("recognition_rate_percent"),
            "reference": params.get("reference"),
        }

    sections.append(ReportSection(title="Parametri Normativi", data=normative_params, order=5))

    # Sezione 6: Risultato Calcolo (riusa riga e passi già caricati in Sezione 4)
    if calc_result_row:
        calc_data = {
            "variation_percent": calc_result_row.variation_percent,
            "threshold_exceeded": (
                abs(calc_result_row.variation_percent or 0)
                > abs(calc_result_row.threshold_percent or 0)
            )
            if calc_result_row.variation_percent is not None
            else None,
            "revision_amount": calc_result_row.revision_amount,
            "revision_type": (
                "aumento"
                if (calc_result_row.revision_amount or 0) > 0
                else "decurtazione"
                if (calc_result_row.revision_amount or 0) < 0
                else None
            ),
            "formula_steps": formula_steps,
        }
    else:
        calc_data = {
            "variation_percent": None,
            "threshold_exceeded": None,
            "revision_amount": None,
            "revision_type": None,
            "formula_steps": [],
        }

    sections.append(ReportSection(title="Risultato Calcolo", data=calc_data, order=6))

    from datetime import datetime

    return ReportResponse(
        case_id=str(case_id),
        sections=sections,
        calculation_result=None,
        generated_at=datetime.utcnow().isoformat(),
    )


def _get_contract_type_label(contract_type: Optional[str]) -> str:
    """Converte contract_type in label italiana"""
    labels = {
        "works": "Lavori",
        "services": "Servizi",
        "service": "Servizi",
        "supplies": "Forniture",
        "supply": "Forniture",
        "mixed": "Misto servizi-forniture",
    }
    return labels.get(contract_type, contract_type or "Non specificato")


def _extract_series_evidence(
    formula_steps: list, saved_result: dict | None, fallback_series_id: str | None
) -> dict:
    """Estrae le serie ISTAT usate nel confronto per il report (trasparenza legale).

    Fonti, in ordine: passi del calcolo salvato in RevisionResult
    (`details.serie` per il singolo, `details.component_details` per il composito),
    risultato persistito nello stato wizard-v2 (copre anche il multi-componente),
    serie selezionata allo step 4 come ultima istanza.
    """
    evidence: dict = {}

    def _from_steps(steps: list, entry: dict) -> None:
        for step in steps or []:
            details = step.get("details") if isinstance(step, dict) else None
            if not isinstance(details, dict):
                continue
            if details.get("serie") and "series_id" not in entry:
                entry["series_id"] = details.get("serie")
            if isinstance(details.get("component_details"), list) and "components" not in entry:
                entry["components"] = details["component_details"]
                if details.get("calculation"):
                    entry["calc_math"] = details["calculation"]

    _from_steps(formula_steps, evidence)

    saved = saved_result if isinstance(saved_result, dict) else {}
    if "series_id" not in evidence and "components" not in evidence:
        wcv = saved.get("weighted_component_variations")
        if isinstance(wcv, list) and wcv:
            evidence["components"] = wcv

    multi = saved.get("components") if saved.get("is_multi_component") else None
    if isinstance(multi, list) and multi:
        groups = []
        for comp in multi:
            if not isinstance(comp, dict):
                continue
            res = comp.get("result") if isinstance(comp.get("result"), dict) else {}
            entry: dict = {
                "description": comp.get("description"),
                "amount": comp.get("amount"),
            }
            _from_steps(res.get("steps") if isinstance(res, dict) else [], entry)
            if "series_id" not in entry and "components" not in entry and isinstance(res, dict):
                for cfg_src in (res.get("indices_config"), comp.get("indices_config")):
                    if isinstance(cfg_src, dict) and cfg_src.get("single_series_id"):
                        entry["series_id"] = cfg_src["single_series_id"]
                        break
            groups.append(entry)
        if groups:
            evidence["multi_components"] = groups

    if (
        fallback_series_id
        and "series_id" not in evidence
        and "components" not in evidence
        and "multi_components" not in evidence
    ):
        evidence["series_id"] = fallback_series_id
    return evidence


@router.post("/cases/{case_id}/calculation")
def add_calculation_to_report(
    case_id: UUID, calculation_result: dict, db: Session = Depends(get_db)
):
    """
    Aggiunge risultato calcolo al report
    (questo endpoint può essere chiamato dopo il calcolo per aggiornare il report)
    """
    case = db.query(CaseFile).filter(CaseFile.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    from app.services.calculation_service import save_result

    # Normalizza il risultato v2 nelle colonne di RevisionResult:
    # il ramo multi-componente espone overall_variation_percent invece di
    # variation_percent e non ha valori sintetici.
    result = dict(calculation_result)
    if result.get("is_multi_component"):
        result["variation_percent"] = result.get("overall_variation_percent")
        overall = result.get("overall_variation_percent")
        threshold = result.get("threshold_percent")
        result["excess_percent"] = (
            max(0.0, (overall or 0.0) - (threshold or 0.0)) if overall is not None else None
        )
        result["base_value"] = None
        result["comparison_value"] = None
        result["recognition_percent"] = None
        if not result.get("steps") and not result.get("formula_detail"):
            result["formula_detail"] = result.get("summary") or ""

    last = (
        db.query(RevisionResult)
        .filter(RevisionResult.case_id == case_id)
        .order_by(RevisionResult.result_version.desc())
        .first()
    )
    next_version = (last.result_version + 1) if last else 1
    record = save_result(db, case_id, result, version=next_version)
    db.commit()

    return {
        "case_id": str(case_id),
        "calculation_saved": True,
        "result_version": next_version,
        "result_id": str(record.id),
    }
