import logging
from datetime import date as _date
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.case_file import CaseFile
from app.models.contract_context import ContractContext
from app.models.cpv_assignment import CpvAssignment
from app.models.cpv_catalog import CpvCatalog
from app.models.revision_result import RevisionResult
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
    # Inquadramento V1 conservato come dato operativo (nessuna funzione su
    # validazione/calcolo): opzionali, mai bloccanti.
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
    wizard_version: str | None = None
    has_v2_state: bool = False


WIZARD_VERSION_KEY = "wizard_version"

WIZARD_VERSIONS = ("v1", "v2", "unified")

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


def _parse_flag(value: object) -> bool | None:
    """Semantica di parsing V1 (wizard.py): truthy set chiuso, resto False."""
    if value is None or value == "":
        return None
    return value in ("true", "True", "1", True, 1)

def _set_wizard_version(db: Session, case_id: UUID, version: str) -> None:
    """Registra quale wizard (v1 7 passi / v2 5 passi) sta usando la pratica."""
    row = (
        db.query(WizardAnswer)
        .filter(
            WizardAnswer.case_id == case_id,
            WizardAnswer.step == 0,
            WizardAnswer.field_key == WIZARD_VERSION_KEY,
        )
        .first()
    )
    if row:
        row.field_value = version
    else:
        db.add(
            WizardAnswer(
                case_id=case_id,
                step=0,
                field_key=WIZARD_VERSION_KEY,
                field_value=version,
            )
        )


def _get_wizard_version(db: Session, case_id: UUID) -> str | None:
    row = (
        db.query(WizardAnswer)
        .filter(
            WizardAnswer.case_id == case_id,
            WizardAnswer.step == 0,
            WizardAnswer.field_key == WIZARD_VERSION_KEY,
        )
        .first()
    )
    if row and row.field_value in WIZARD_VERSIONS:
        return row.field_value
    return None


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


def _parse_duration(value: object) -> int | None:
    if value is None or value == "":
        return None
    try:
        n = int(float(str(value).strip()))
    except (ValueError, TypeError):
        return None
    return n if n >= 0 else None


def _fill_from_projections(
    state: WizardV2State,
    contract: ContractContext | None,
    step2: dict[str, str],
    *,
    gaps_only: bool,
) -> None:
    """Ricostruisce inquadramento + date da ContractContext con fallback alle
    risposte legacy step 2 (pratiche V1 esistenti: date visibili subito senza
    reinserimento). Con gaps_only=True riempie solo i campi assenti del blob."""

    def _set(attr: str, value: object) -> None:
        if gaps_only and getattr(state, attr) not in (None, ""):
            return
        setattr(state, attr, value)

    if contract is not None:
        if contract.contract_type:
            _set("contract_type", normalize_contract_type(contract.contract_type))
        if contract.is_duration_contract is not None:
            _set("is_duration_contract", contract.is_duration_contract)
        if contract.instant_execution is not None:
            _set("instant_execution", contract.instant_execution)
        if contract.stipulation_date is not None:
            _set("stipulation_date", contract.stipulation_date.isoformat())
        if contract.execution_start_date is not None:
            _set("execution_start_date", contract.execution_start_date.isoformat())
        if contract.contract_end_date is not None:
            _set("contract_end_date", contract.contract_end_date.isoformat())
        if contract.duration_months is not None:
            _set("duration_months", contract.duration_months)
        if not gaps_only and contract.amount_subject_to_revision:
            state.amount = contract.amount_subject_to_revision

    if step2.get("contract_type"):
        _set("contract_type", normalize_contract_type(step2["contract_type"]))
    for key in ("is_duration_contract", "instant_execution"):
        if key in step2:
            _set(key, _parse_flag(step2[key]))
    for key in ("stipulation_date", "execution_start_date", "contract_end_date"):
        if step2.get(key):
            parsed = _parse_iso_date(step2[key])
            if parsed is not None:
                _set(key, parsed.isoformat())
    if step2.get("duration_months"):
        parsed_dur = _parse_duration(step2["duration_months"])
        if parsed_dur is not None:
            _set("duration_months", parsed_dur)
    if not state.amount:
        for key in ("amount_subject_to_revision", "contract_amount_total"):
            if step2.get(key):
                try:
                    state.amount = float(step2[key])
                    break
                except (ValueError, TypeError):
                    continue


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
            _LOG.debug("wizard_v2_state parse failed, falling back to default", exc_info=True)
            pass  # intentionally ignore corrupt saved state: reconstruct from contract/tol/cpv
    contract = db.query(ContractContext).filter(ContractContext.case_id == case_id).first()
    step2_answers = {
        a.field_key: a.field_value
        for a in db.query(WizardAnswer)
        .filter(
            WizardAnswer.case_id == case_id,
            WizardAnswer.step == 2,
        )
        .all()
    }
    if not saved:
        tol_asgn = db.query(TolAssignment).filter(TolAssignment.case_id == case_id).all()
        if tol_asgn:
            state.tol_selections = [
                TolSelectionSchema(code=t.code, weight=t.weight_percent) for t in tol_asgn
            ]

        cpv_primary = (
            db.query(CpvAssignment)
            .filter(
                CpvAssignment.case_id == case_id,
                CpvAssignment.is_primary.is_(True),
            )
            .first()
        )
        if cpv_primary:
            state.cpv_code = cpv_primary.cpv_code
            state.cpv_description = cpv_primary.description

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

        step_answers = {
            a.field_key: a.field_value
            for a in db.query(WizardAnswer)
            .filter(
                WizardAnswer.case_id == case_id,
                WizardAnswer.step == 3,
            )
            .all()
        }
        if step_answers.get("contract_type"):
            state.contract_type = step_answers["contract_type"]
        if step_answers.get("amount_subject_to_revision"):
            try:
                state.amount = float(step_answers["amount_subject_to_revision"])
            except (ValueError, TypeError):
                safe_amount = (
                    str(step_answers.get("amount_subject_to_revision", ""))
                    .replace("\r\n", "")
                    .replace("\n", "")
                    .replace("\r", "")
                )
                _LOG.warning(
                    "Could not parse amount '%s' for case %s",
                    safe_amount,
                    str(case_id).replace("\r\n", "").replace("\n", "").replace("\r", ""),
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

        _fill_from_projections(state, contract, step2_answers, gaps_only=False)
    else:
        # Blob di pratiche unificate precedenti: normalizza il tipo e riempie
        # solo i campi nuovi assenti (mai overwrite dei valori utente).
        state.contract_type = normalize_contract_type(state.contract_type)
        _fill_from_projections(state, contract, step2_answers, gaps_only=True)

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
        wizard_version=_get_wizard_version(db, case_id),
        has_v2_state=saved is not None,
    )


@router.put("")
def save_wizard_v2_state(case_id: UUID, payload: WizardV2State, db: Session = Depends(get_db)):
    case = db.query(CaseFile).filter(CaseFile.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    import json

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
        # Specchio pieno del blob (None compreso): il blob è fonte, la
        # proiezione lo segue così il fallback GET non resuscita valori
        # cancellati. I flag restano puro dato operativo: nessun effetto su
        # validazione, branching o calcolo.
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

    _set_wizard_version(db, case_id, "unified")
    db.commit()
    return {"status": "ok", "case_id": str(case_id)}


class WizardVersionSave(BaseModel):
    version: Literal["v1", "v2", "unified"]


@router.put("/version")
def save_wizard_version(case_id: UUID, payload: WizardVersionSave, db: Session = Depends(get_db)):
    """Registra quale wizard usa la pratica, senza toccare lo stato (nessun side effect)."""
    case = db.query(CaseFile).filter(CaseFile.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    _set_wizard_version(db, case_id, payload.version)
    db.commit()
    return {"status": "ok", "case_id": str(case_id), "wizard_version": payload.version}
