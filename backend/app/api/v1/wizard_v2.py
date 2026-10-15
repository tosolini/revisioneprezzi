import json
import logging
from datetime import date as _date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.case_file import CaseFile
from app.models.contract_context import ContractContext
from app.models.cpv_assignment import CpvAssignment
from app.models.cpv_catalog import CpvCatalog
from app.models.tol import TolAssignment
from app.models.wizard_answer import WizardAnswer

_LOG = logging.getLogger(__name__)


class TolSelectionSchema(BaseModel):
    code: str
    weight: float


class WizardCpvSelection(BaseModel):
    """Selezione CPV singola (servizi/forniture, Art. 13 multi-CPV)."""

    cpv_code: str
    description: str | None = None
    weight: float | None = None


class WizardAtecoSelection(BaseModel):
    """Codice ATECO dal testo contrattuale (pesi di conferma, Art. 11.3)."""

    ateco_code: str
    weight: float


class IndicesConfigSchema(BaseModel):
    type: str
    single_series_id: str | None = None
    components: dict[str, float] | None = None


class WizardV2State(BaseModel):
    current_step: int = 1
    contract_type: str = ""
    # Inquadramento operativo (nessuna funzione su validazione/calcolo):
    # opzionali, mai bloccanti.
    is_duration_contract: bool | None = None
    instant_execution: bool | None = None
    # Dati contrattuali step 3: date ISO YYYY-MM-DD, durata in mesi interi.
    stipulation_date: str | None = None
    execution_start_date: str | None = None
    contract_end_date: str | None = None
    duration_months: int | None = None
    tol_selections: list[TolSelectionSchema] = []
    cpv_code: str | None = None
    cpv_description: str | None = None
    cpv_selections: list[WizardCpvSelection] = []
    ateco_selections: list[WizardAtecoSelection] = []
    amount: float = 0.0
    base_period: str | None = None
    comparison_period: str | None = None
    indices_config: IndicesConfigSchema | None = None
    result: dict | None = None


class WizardV2Response(BaseModel):
    case_id: str
    title: str
    state: WizardV2State

# Vocabolario canonico chiuso 1.2.0: unione V1 {service,supply,mixed} + V2
# {works,services,supplies}. In scrittura solo canonico; in lettura le forme
# legacy service/supply sono normalizzate.
CANONICAL_CONTRACT_TYPES = ("works", "services", "supplies", "mixed")

_LEGACY_CONTRACT_TYPE = {"service": "services", "supply": "supplies"}


def normalize_contract_type(value: str | None) -> str:
    """Riporta una forma legacy al vocabolario canonico (write-canonical)."""
    if not value:
        return ""
    return _LEGACY_CONTRACT_TYPE.get(value, value)


def _parse_iso_date(value: object) -> _date | None:
    """YYYY-MM-DD → date; stringhe vuote/malformate → None (mai eccezioni)."""
    if value is None:
        return None
    if isinstance(value, _date):
        return value
    s = str(value).strip()
    if not s:
        return None
    try:
        return _date.fromisoformat(s[:10])
    except ValueError:
        return None


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
            state = WizardV2State(**json.loads(saved.field_value))
        except Exception:
            # Blob corrotto: si riparte dallo stato vuoto.
            _LOG.debug("wizard_v2_state parse failed, falling back to default", exc_info=True)
            saved = None

    if not saved:
        state.current_step = case.current_step or 1
    else:
        # Normalizza il tipo (blob scritti prima del vocabolario chiuso).
        state.contract_type = normalize_contract_type(state.contract_type)

    # Sincronizzazione retro-compat: cpv_selections ↔ cpv_code/description.
    if state.contract_type in ("services", "supplies", "mixed"):
        if not state.cpv_selections:
            all_cpv = (
                db.query(CpvAssignment)
                .filter(CpvAssignment.case_id == case_id)
                .order_by(CpvAssignment.is_primary.desc())
                .all()
            )
            if all_cpv:
                state.cpv_selections = [
                    WizardCpvSelection(
                        cpv_code=c.cpv_code,
                        description=c.description,
                        weight=c.weight_percent,
                    )
                    for c in all_cpv
                ]
            elif state.cpv_code:
                state.cpv_selections = [
                    WizardCpvSelection(
                        cpv_code=state.cpv_code,
                        description=state.cpv_description,
                    )
                ]
        elif not state.cpv_code:
            state.cpv_code = state.cpv_selections[0].cpv_code
            state.cpv_description = state.cpv_selections[0].description

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

    # Write-canonical: il blob conserva solo il vocabolario chiuso 1.2.0.
    payload.contract_type = normalize_contract_type(payload.contract_type)

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
        db.add(
            WizardAnswer(
                case_id=case_id,
                step=0,
                field_key="wizard_v2_state",
                field_value=json.dumps(payload.model_dump()),
            )
        )


    if payload.contract_type:
        contract = db.query(ContractContext).filter(ContractContext.case_id == case_id).first()
        if not contract:
            contract = ContractContext(case_id=case_id)
            db.add(contract)
        contract.contract_type = payload.contract_type
        if payload.amount > 0:
            contract.amount_subject_to_revision = payload.amount
        # Specchio pieno del blob (None compreso): il blob è la fonte,
        # la proiezione lo segue. I flag restano puro dato operativo:
        # nessun effetto su validazione, branching o calcolo.
        contract.is_duration_contract = payload.is_duration_contract
        contract.instant_execution = payload.instant_execution
        contract.stipulation_date = _parse_iso_date(payload.stipulation_date)
        contract.execution_start_date = _parse_iso_date(payload.execution_start_date)
        contract.contract_end_date = _parse_iso_date(payload.contract_end_date)
        contract.duration_months = payload.duration_months

    if payload.contract_type == "works" and payload.tol_selections:
        db.query(TolAssignment).filter(TolAssignment.case_id == case_id).delete()
        for sel in payload.tol_selections:
            db.add(
                TolAssignment(
                    case_id=case_id,
                    tol_code=sel.code,
                    weight_percent=sel.weight,
                )
            )

    if payload.contract_type in ("services", "supplies", "mixed") and (
        payload.cpv_selections or payload.cpv_code
    ):
        db.query(CpvAssignment).filter(CpvAssignment.case_id == case_id).delete()
        selections = list(payload.cpv_selections)
        if not selections and payload.cpv_code:
            selections = [
                WizardCpvSelection(
                    cpv_code=payload.cpv_code,
                    description=payload.cpv_description,
                )
            ]
        for i, sel in enumerate(selections):
            cat = db.query(CpvCatalog).filter(CpvCatalog.cpv_code == sel.cpv_code).first()
            db.add(
                CpvAssignment(
                    case_id=case_id,
                    cpv_code=sel.cpv_code,
                    is_primary=i == 0,
                    weight_percent=sel.weight,
                    description=cat.description if cat else sel.description,
                )
            )

    case.current_step = payload.current_step
    # Marca completata solo quando il report V2 (passo 5) ha un risultato calcolato.
    if payload.current_step >= 5 and payload.result is not None:
        case.status = "completed"

    db.commit()
    return {"status": "ok", "case_id": str(case_id)}
