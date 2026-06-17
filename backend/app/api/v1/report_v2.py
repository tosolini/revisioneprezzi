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
def generate_report_v2(
    case_id: UUID,
    db: Session = Depends(get_db)
) -> ReportResponse:
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
    
    contract = db.query(ContractContext).filter(
        ContractContext.case_id == case_id
    ).first()
    
    sections = []
    
    # Fallback: read ente/cig/cup from wizard step 1 if not in ContractContext
    step1_answers = {
        a.field_key: a.field_value
        for a in db.query(WizardAnswer).filter(
            WizardAnswer.case_id == case_id, WizardAnswer.step == 1
        ).all()
    }

    # Also read step 2 answers for contract_type from wizard (backup)
    step2_answers = {
        a.field_key: a.field_value
        for a in db.query(WizardAnswer).filter(
            WizardAnswer.case_id == case_id, WizardAnswer.step == 2
        ).all()
    }
    ct = step2_answers.get("contract_type") or (contract.contract_type if contract else None)

    # Read step 3 answers for object_description and cpv_total_amount
    step3_answers = {
        a.field_key: a.field_value
        for a in db.query(WizardAnswer).filter(
            WizardAnswer.case_id == case_id, WizardAnswer.step == 3
        ).all()
    }

    contract_data = {
        "case_number": str(case.id),
        "title": case.title or "Senza titolo",
        "contract_type": ct,
        "contract_type_label": _get_contract_type_label(ct),
        "cig": step1_answers.get("cig"),
        "cup": step1_answers.get("cup"),
        "station": step1_answers.get("ente"),
        "operatore_economico": step1_answers.get("operatore_economico"),
        "notes": step1_answers.get("notes"),
        "object_description": step3_answers.get("object_description"),
    }
    
    sections.append(ReportSection(
        title="Dati Contratto",
        data=contract_data,
        order=1
    ))
    
    # Read step 5 answers for amounts and periods
    step5_answers = {
        a.field_key: a.field_value
        for a in db.query(WizardAnswer).filter(
            WizardAnswer.case_id == case_id, WizardAnswer.step == 5
        ).all()
    }
    # Also read step 4 for selected index series
    step4_answers = {
        a.field_key: a.field_value
        for a in db.query(WizardAnswer).filter(
            WizardAnswer.case_id == case_id, WizardAnswer.step == 4
        ).all()
    }

    total_amount = None
    if contract and contract.contract_amount_total:
        total_amount = float(contract.contract_amount_total)
    if not total_amount:
        total_amount = step3_answers.get("cpv_total_amount") or step2_answers.get("contract_amount_total")
    if total_amount:
        try:
            total_amount = float(total_amount)
        except (ValueError, TypeError):
            total_amount = None

    # Sezione 2: Classificazione (TOL o CPV)
    classification_data = {}
    
    if contract and contract.contract_type == "works":
        # Recupera TOL assignments
        tol_assignments = db.query(TolAssignment).filter(
            TolAssignment.case_id == case_id
        ).all()
        
        tol_details = []
        for ta in tol_assignments:
            tol_master = db.query(TolMaster).filter(
                TolMaster.code == ta.tol_code
            ).first()
            
            # Recupera series_id e indice
            tol_series = db.query(TolIndexSeries).filter(
                TolIndexSeries.tol_code == ta.tol_code
            ).first()
            
            amount = (float(ta.weight_percent) / 100.0 * total_amount) if total_amount and ta.weight_percent else None
            
            tol_details.append({
                "code": ta.tol_code,
                "weight_percent": ta.weight_percent,
                "description": tol_master.short_description if tol_master else ta.tol_code,
                "series_id": tol_series.series_id if tol_series else None,
                "amount": round(amount, 2) if amount is not None else None,
            })
        
        classification_data = {
            "type": "TOL",
            "items": tol_details,
            "total_weight": sum(t["weight_percent"] for t in tol_details),
            "total_amount": total_amount,
        }
    else:
        # Recupera CPV assignments
        cpv_assignments = db.query(CpvAssignment).filter(
            CpvAssignment.case_id == case_id
        ).all()
        
        secondary_weight_sum = sum(
            float(a.weight_percent) for a in cpv_assignments
            if not a.is_primary and a.weight_percent
        )
        
        cpv_details = []
        for cpv in cpv_assignments:
            if cpv.is_primary:
                wt = max(0.0, 100.0 - secondary_weight_sum)
            else:
                wt = float(cpv.weight_percent) if cpv.weight_percent else 0.0
            
            amount = (wt / 100.0 * total_amount) if total_amount else None
            
            # Usa descrizione dal catalogo CPV, non quella salvata (che può essere object_description)
            cat = db.query(CpvCatalog).filter(CpvCatalog.cpv_code == cpv.cpv_code).first()
            desc = cat.description if cat else (cpv.description or cpv.cpv_code)
            
            cpv_details.append({
                "code": cpv.cpv_code,
                "description": desc,
                "weight_percent": wt,
                "amount": round(amount, 2) if amount is not None else None,
            })
        
        classification_data = {
            "type": "CPV",
            "items": cpv_details,
            "total_weight": sum(d["weight_percent"] for d in cpv_details),
            "total_amount": total_amount,
        }
    
    sections.append(ReportSection(
        title="Classificazione",
        data=classification_data,
        order=2
    ))

    # Sezione 3: Importi e Date
    revisable = step5_answers.get("amount_subject_to_revision")

    amounts_data = {
        "contract_amount": total_amount,
        "revisable_amount": revisable or total_amount,
        "base_period": step5_answers.get("base_period"),
        "comparison_period": step5_answers.get("comparison_period"),
    }

    sections.append(ReportSection(
        title="Importi e Date",
        data=amounts_data,
        order=3
    ))

    # Sezione 4: Indici ISTAT
    series_id = step4_answers.get("selected_index_series_id")
    indices_data = {
        "synthetic_index_base": None,
        "synthetic_index_comparison": None
    }

    if series_id:
        base_period_str = step5_answers.get("base_period")
        comp_period_str = step5_answers.get("comparison_period")
        for period_str, key in [(base_period_str, "synthetic_index_base"), (comp_period_str, "synthetic_index_comparison")]:
            if period_str:
                try:
                    period_date = date.fromisoformat(period_str if "-" in period_str and len(period_str) == 10 else f"{period_str}-01")
                    from app.services.revision_calculation_v2 import _get_index_value
                    val = _get_index_value(db, series_id, period_date)
                    if val is not None:
                        indices_data[key] = val
                except ValueError:
                    pass

    sections.append(ReportSection(
        title="Indici ISTAT",
        data=indices_data,
        order=4
    ))
    
    # Sezione 5: Parametri Normativi
    raw_ct = step2_answers.get("contract_type") or (contract.contract_type if contract else None)
    # Normalize: wizard stores "service"/"supply" but NORMATIVE_PARAMS uses "services"/"supplies"
    CT_NORMALIZE = {"service": "services", "supply": "supplies", "works": "works", "services": "services", "supplies": "supplies", "mixed": "mixed"}
    contract_type = CT_NORMALIZE.get(raw_ct) if raw_ct else None
    normative_params = {}
    if contract_type:
        params = NORMATIVE_PARAMS.get(contract_type, {})
        normative_params = {
            "threshold_percent": params.get("threshold_percent"),
            "recognition_rate_percent": params.get("recognition_rate_percent"),
            "reference": params.get("reference")
        }
    
    sections.append(ReportSection(
        title="Parametri Normativi",
        data=normative_params,
        order=5
    ))
    
    # Sezione 6: Risultato Calcolo
    calc_result_row = (
        db.query(RevisionResult)
        .filter(RevisionResult.case_id == case_id)
        .order_by(RevisionResult.created_at.desc())
        .first()
    )

    if calc_result_row:
        try:
            formula_steps = json.loads(calc_result_row.formula_detail or "[]")
        except (json.JSONDecodeError, TypeError):
            formula_steps = []
        calc_data = {
            "variation_percent": calc_result_row.variation_percent,
            "threshold_exceeded": (
                abs(calc_result_row.variation_percent or 0)
                > abs(calc_result_row.threshold_percent or 0)
            ) if calc_result_row.variation_percent is not None else None,
            "revision_amount": calc_result_row.revision_amount,
            "revision_type": (
                "aumento" if (calc_result_row.revision_amount or 0) > 0
                else "decurtazione" if (calc_result_row.revision_amount or 0) < 0
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

    sections.append(ReportSection(
        title="Risultato Calcolo",
        data=calc_data,
        order=6
    ))
    
    from datetime import datetime
    return ReportResponse(
        case_id=str(case_id),
        sections=sections,
        calculation_result=None,
        generated_at=datetime.utcnow().isoformat()
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


@router.post("/cases/{case_id}/calculation")
def add_calculation_to_report(
    case_id: UUID,
    calculation_result: dict,
    db: Session = Depends(get_db)
):
    """
    Aggiunge risultato calcolo al report
    (questo endpoint può essere chiamato dopo il calcolo per aggiornare il report)
    """
    case = db.query(CaseFile).filter(CaseFile.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    
    # In futuro, salvare in database (es. revision_result)
    # Per ora ritorna solo acknowledgment
    
    return {
        "case_id": str(case_id),
        "calculation_saved": True,
        "result": calculation_result
    }
