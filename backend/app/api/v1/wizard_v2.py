import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

_LOG = logging.getLogger(__name__)

from app.core.database import get_db
from app.models.case_file import CaseFile
from app.models.contract_context import ContractContext
from app.models.cpv_assignment import CpvAssignment
from app.models.cpv_catalog import CpvCatalog
from app.models.revision_result import RevisionResult
from app.models.tol import TolAssignment
from app.models.wizard_answer import WizardAnswer


class TolSelectionSchema(BaseModel):
    code: str
    weight: float


class IndicesConfigSchema(BaseModel):
    type: str
    single_series_id: str | None = None
    components: dict[str, float] | None = None


class WizardV2State(BaseModel):
    current_step: int = 1
    contract_type: str = ""
    tol_selections: list[TolSelectionSchema] = []
    cpv_code: str | None = None
    cpv_description: str | None = None
    amount: float = 0.0
    base_period: str | None = None
    comparison_period: str | None = None
    indices_config: IndicesConfigSchema | None = None
    result: dict | None = None


class WizardV2Response(BaseModel):
    case_id: str
    title: str
    state: WizardV2State


router = APIRouter(prefix="/cases/{case_id}/wizard-v2", tags=["wizard-v2"])


@router.get("")
def get_wizard_v2_state(case_id: UUID, db: Session = Depends(get_db)) -> WizardV2Response:
    case = db.query(CaseFile).filter(CaseFile.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    state = WizardV2State()

    saved = (
        db.query(WizardAnswer)
        .filter(
            WizardAnswer.case_id == case_id,
            WizardAnswer.step == 0,
            WizardAnswer.field_key == "wizard_v2_state",
        )
        .first()
    )
    if saved and saved.field_value:
        try:
            import json
            parsed = json.loads(saved.field_value)
            state = WizardV2State(**parsed)
        except Exception:
            pass

    if not saved:
        contract = db.query(ContractContext).filter(
            ContractContext.case_id == case_id
        ).first()
        if contract:
            state.contract_type = contract.contract_type or ""
            if contract.amount_subject_to_revision:
                state.amount = contract.amount_subject_to_revision

        tol_asgn = db.query(TolAssignment).filter(
            TolAssignment.case_id == case_id
        ).all()
        if tol_asgn:
            state.tol_selections = [
                TolSelectionSchema(code=t.code, weight=t.weight_percent)
                for t in tol_asgn
            ]

        cpv_primary = db.query(CpvAssignment).filter(
            CpvAssignment.case_id == case_id,
            CpvAssignment.is_primary.is_(True),
        ).first()
        if cpv_primary:
            state.cpv_code = cpv_primary.cpv_code
            state.cpv_description = cpv_primary.description

        step_answers = {
            a.field_key: a.field_value
            for a in db.query(WizardAnswer).filter(
                WizardAnswer.case_id == case_id,
                WizardAnswer.step == 3,
            ).all()
        }
        if step_answers.get("contract_type"):
            state.contract_type = step_answers["contract_type"]
        if step_answers.get("amount_subject_to_revision"):
            try:
                state.amount = float(step_answers["amount_subject_to_revision"])
            except (ValueError, TypeError):
                _LOG.warning(
                    "Could not parse amount '%s' for case %s",
                    step_answers.get("amount_subject_to_revision"),
                    case_id,
                )
        if step_answers.get("base_period"):
            state.base_period = step_answers["base_period"]
        if step_answers.get("comparison_period"):
            state.comparison_period = step_answers["comparison_period"]

        last_result = (
            db.query(RevisionResult)
            .filter(RevisionResult.case_id == case_id)
            .order_by(RevisionResult.created_at.desc())
            .first()
        )
        if last_result:
            state.result = {
                "base_value": last_result.base_value,
                "comparison_value": last_result.comparison_value,
                "variation_percent": last_result.variation_percent,
                "threshold_percent": last_result.threshold_percent,
                "excess_percent": last_result.excess_percent,
                "recognition_percent": last_result.recognition_percent,
                "revision_amount": last_result.revision_amount,
                "formula_detail": last_result.formula_detail,
            }

        state.current_step = case.current_step or 1

    return WizardV2Response(
        case_id=str(case.id),
        title=case.title,
        state=state,
    )


@router.put("")
def save_wizard_v2_state(case_id: UUID, payload: WizardV2State, db: Session = Depends(get_db)):
    case = db.query(CaseFile).filter(CaseFile.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    import json

    existing = (
        db.query(WizardAnswer)
        .filter(
            WizardAnswer.case_id == case_id,
            WizardAnswer.step == 0,
            WizardAnswer.field_key == "wizard_v2_state",
        )
        .first()
    )
    if existing:
        existing.field_value = json.dumps(payload.model_dump())
    else:
        db.add(WizardAnswer(
            case_id=case_id,
            step=0,
            field_key="wizard_v2_state",
            field_value=json.dumps(payload.model_dump()),
        ))

    if payload.contract_type:
        contract = (
            db.query(ContractContext)
            .filter(ContractContext.case_id == case_id)
            .first()
        )
        if not contract:
            contract = ContractContext(case_id=case_id)
            db.add(contract)
        contract.contract_type = payload.contract_type
        if payload.amount > 0:
            contract.amount_subject_to_revision = payload.amount

    if payload.contract_type == "works" and payload.tol_selections:
        db.query(TolAssignment).filter(TolAssignment.case_id == case_id).delete()
        for sel in payload.tol_selections:
            db.add(TolAssignment(
                case_id=case_id,
                tol_code=sel.code,
                weight_percent=sel.weight,
            ))

    if payload.contract_type in ("services", "supplies") and payload.cpv_code:
        db.query(CpvAssignment).filter(CpvAssignment.case_id == case_id).delete()
        cat = db.query(CpvCatalog).filter(
            CpvCatalog.cpv_code == payload.cpv_code
        ).first()
        db.add(CpvAssignment(
            case_id=case_id,
            cpv_code=payload.cpv_code,
            is_primary=True,
            description=cat.description if cat else payload.cpv_description,
        ))

    case.current_step = payload.current_step

    db.commit()
    return {"status": "ok", "case_id": str(case_id)}
