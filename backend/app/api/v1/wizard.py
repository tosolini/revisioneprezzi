from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.case_file import CaseFile
from app.models.contract_context import ContractContext
from app.models.cpv_assignment import CpvAssignment
from app.models.cpv_catalog import CpvCatalog
from app.models.wizard_answer import WizardAnswer
from app.schemas.wizard import WizardAnswerResponse, WizardStepSave

router = APIRouter(prefix="/cases/{case_id}/wizard", tags=["wizard"])


@router.post("/{step}", response_model=list[WizardAnswerResponse], status_code=201)
def save_wizard_step(
    case_id: UUID, step: int, payload: WizardStepSave, db: Session = Depends(get_db)
):
    case = db.query(CaseFile).filter(CaseFile.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    answers = []
    for ans in payload.answers:
        answer = WizardAnswer(
            case_id=case_id, step=step, field_key=ans.field_key, field_value=ans.field_value
        )
        db.add(answer)
        answers.append(answer)

    case.current_step = step

    if step == 2:
        _sync_contract_context(case_id, payload.answers, db)
    elif step == 3:
        _sync_cpv_assignments(case_id, payload.answers, db)

    db.commit()
    for a in answers:
        db.refresh(a)
    return answers


def _sync_contract_context(case_id: UUID, answers: list, db: Session) -> None:
    vals = {a.field_key: a.field_value for a in answers}

    contract = (
        db.query(ContractContext)
        .filter(ContractContext.case_id == case_id)
        .first()
    )
    if not contract:
        contract = ContractContext(case_id=case_id)
        db.add(contract)

    if "contract_type" in vals:
        contract.contract_type = vals["contract_type"]
    if "is_duration_contract" in vals:
        contract.is_duration_contract = vals["is_duration_contract"] in ("true", "True", "1", True)
    if "instant_execution" in vals:
        contract.instant_execution = vals["instant_execution"] in ("true", "True", "1", True)
    if "stipulation_date" in vals and vals["stipulation_date"]:
        contract.stipulation_date = vals["stipulation_date"]
    if "execution_start_date" in vals and vals["execution_start_date"]:
        contract.execution_start_date = vals["execution_start_date"]
    if "duration_months" in vals and vals["duration_months"]:
        contract.duration_months = int(float(vals["duration_months"]))
    if "contract_amount_total" in vals and vals["contract_amount_total"]:
        contract.contract_amount_total = float(vals["contract_amount_total"])
    if "amount_subject_to_revision" in vals and vals["amount_subject_to_revision"]:
        contract.amount_subject_to_revision = float(vals["amount_subject_to_revision"])


def _sync_cpv_assignments(case_id: UUID, answers: list, db: Session) -> None:
    vals = {a.field_key: a.field_value for a in answers}

    primary_code = vals.get("cpv_primary", "").strip()
    if not primary_code:
        db.query(CpvAssignment).filter(CpvAssignment.case_id == case_id).delete()
        return

    description = vals.get("object_description", "").strip() or None
    secondary_raw = vals.get("cpv_secondary", "").strip()
    weights_raw = vals.get("cpv_secondary_weights", "").strip()

    secondary_codes = [c.strip() for c in secondary_raw.split(",") if c.strip()] if secondary_raw else []
    weights = [float(w.strip()) for w in weights_raw.split(",") if w.strip()] if weights_raw else []

    if not description:
        cat = db.query(CpvCatalog).filter(CpvCatalog.cpv_code == primary_code).first()
        if cat:
            description = cat.description

    db.query(CpvAssignment).filter(CpvAssignment.case_id == case_id).delete()

    db.add(CpvAssignment(
        case_id=case_id, cpv_code=primary_code, is_primary=True,
        weight_percent=None, description=description,
    ))

    for i, code in enumerate(secondary_codes):
        w = weights[i] if i < len(weights) else None
        sec_desc = None
        cat = db.query(CpvCatalog).filter(CpvCatalog.cpv_code == code).first()
        if cat:
            sec_desc = cat.description
        db.add(CpvAssignment(
            case_id=case_id, cpv_code=code, is_primary=False,
            weight_percent=w, description=sec_desc,
        ))


@router.get("/{step}", response_model=list[WizardAnswerResponse])
def get_wizard_step(
    case_id: UUID, step: int, db: Session = Depends(get_db)
):
    case = db.query(CaseFile).filter(CaseFile.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    answers = (
        db.query(WizardAnswer)
        .filter(WizardAnswer.case_id == case_id, WizardAnswer.step == step)
        .all()
    )
    return answers
