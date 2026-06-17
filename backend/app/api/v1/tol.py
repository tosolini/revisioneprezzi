"""
API endpoints per TOL (Tipologie Omogenee Lavorazioni)
Secondo Allegato II.2-bis Tabella A
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.models.tol import TolAssignment, TolIndexSeries, TolMaster
from app.schemas.tol import (
    TolAssignmentBulkCreate,
    TolAssignmentCreate,
    TolAssignmentResponse,
    TolAssignmentUpdate,
    TolIndexSeriesResponse,
    TolListResponse,
    TolMasterResponse,
    TolValidationResponse,
    TolWithIndicesResponse,
)

router = APIRouter(prefix="/tol", tags=["tol"])


@router.get("/list", response_model=list[TolListResponse])
def list_tol(
    include_specialized: bool = True,
    db: Session = Depends(get_db)
) -> list[TolListResponse]:
    """
    Lista delle 20 TOL (Tipologie Omogenee Lavorazioni)
    
    Query params:
    - include_specialized: se False, esclude TOL specializzate (default: True)
    """
    query = select(TolMaster).order_by(TolMaster.sequence)
    
    if not include_specialized:
        query = query.where(TolMaster.is_specialized.is_(False))
    
    result = db.execute(query)
    tols = result.scalars().all()
    
    return [
        TolListResponse(
            code=t.code,
            sequence=t.sequence,
            short_description=t.short_description,
            is_specialized=t.is_specialized
        )
        for t in tols
    ]


@router.get("/{tol_code}", response_model=TolMasterResponse)
def get_tol_detail(tol_code: str, db: Session = Depends(get_db)) -> TolMasterResponse:
    """
    Dettaglio completo di una TOL con declaratoria
    
    Path params:
    - tol_code: Codice TOL (es. TOL.1, TOL.7, etc.)
    """
    tol = db.execute(
        select(TolMaster).where(TolMaster.code == tol_code)
    ).scalar_one_or_none()
    
    if not tol:
        raise HTTPException(status_code=404, detail=f"TOL {tol_code} non trovata")
    
    return TolMasterResponse.model_validate(tol)


@router.get("/{tol_code}/indices", response_model=list[TolIndexSeriesResponse])
def get_tol_indices(
    tol_code: str,
    active_only: bool = True,
    db: Session = Depends(get_db)
) -> list[TolIndexSeriesResponse]:
    """
    Serie indici ISTAT/MIT associate a una TOL
    
    Path params:
    - tol_code: Codice TOL
    
    Query params:
    - active_only: ritorna solo serie attive (default: True)
    """
    query = select(TolIndexSeries).where(TolIndexSeries.tol_code == tol_code)
    
    if active_only:
        query = query.where(TolIndexSeries.is_active.is_(True))
    
    query = query.order_by(TolIndexSeries.created_at.desc())
    
    result = db.execute(query)
    indices = result.scalars().all()
    
    return [TolIndexSeriesResponse.model_validate(idx) for idx in indices]


@router.get("/{tol_code}/with-indices", response_model=TolWithIndicesResponse)
def get_tol_with_indices(
    tol_code: str,
    db: Session = Depends(get_db)
) -> TolWithIndicesResponse:
    """
    TOL completa con serie indici associate
    """
    tol = db.execute(
        select(TolMaster).where(TolMaster.code == tol_code)
    ).scalar_one_or_none()
    
    if not tol:
        raise HTTPException(status_code=404, detail=f"TOL {tol_code} non trovata")
    
    indices = db.execute(
        select(TolIndexSeries)
        .where(TolIndexSeries.tol_code == tol_code)
        .where(TolIndexSeries.is_active.is_(True))
        .order_by(TolIndexSeries.created_at.desc())
    ).scalars().all()
    
    return TolWithIndicesResponse(
        **TolMasterResponse.model_validate(tol).model_dump(),
        indices=[TolIndexSeriesResponse.model_validate(idx) for idx in indices]
    )


# Case TOL Assignments
@router.get("/case/{case_id}/assignments", response_model=list[TolAssignmentResponse])
def get_case_tol_assignments(
    case_id: UUID,
    db: Session = Depends(get_db)
) -> list[TolAssignmentResponse]:
    """
    Lista assegnazioni TOL per una pratica
    """
    assignments = db.execute(
        select(TolAssignment)
        .where(TolAssignment.case_id == case_id)
        .options(joinedload(TolAssignment.tol_master))
        .order_by(TolAssignment.created_at)
    ).scalars().all()
    
    return [TolAssignmentResponse.model_validate(a) for a in assignments]


@router.post("/case/{case_id}/assignments", response_model=list[TolAssignmentResponse])
def create_case_tol_assignments(
    case_id: UUID,
    data: TolAssignmentBulkCreate,
    db: Session = Depends(get_db)
) -> list[TolAssignmentResponse]:
    """
    Crea assegnazioni TOL per una pratica
    
    Validazioni:
    - Verifica che i codici TOL esistano
    - Verifica che i pesi sommino a 100% (se multi-TOL)
    - Cancella eventuali assegnazioni precedenti
    """
    # Verifica che la pratica esista
    from app.models.case_file import CaseFile
    case = db.execute(
        select(CaseFile).where(CaseFile.id == case_id)
    ).scalar_one_or_none()
    
    if not case:
        raise HTTPException(status_code=404, detail="Pratica non trovata")
    
    # Verifica che tutti i codici TOL esistano
    tol_codes = [a.tol_code for a in data.assignments]
    existing_tols = db.execute(
        select(TolMaster.code).where(TolMaster.code.in_(tol_codes))
    ).scalars().all()
    
    missing_codes = set(tol_codes) - set(existing_tols)
    if missing_codes:
        raise HTTPException(
            status_code=400,
            detail=f"Codici TOL non validi: {', '.join(missing_codes)}"
        )
    
    # Cancella assegnazioni precedenti
    db.execute(
        select(TolAssignment)
        .where(TolAssignment.case_id == case_id)
    )
    db.query(TolAssignment).filter(TolAssignment.case_id == case_id).delete()
    
    # Crea nuove assegnazioni
    assignments = []
    for a in data.assignments:
        assignment = TolAssignment(
            case_id=case_id,
            tol_code=a.tol_code,
            weight_percent=a.weight_percent,
            notes=a.notes
        )
        db.add(assignment)
        assignments.append(assignment)
    
    db.commit()
    
    # Ricarica con relazioni
    result = db.execute(
        select(TolAssignment)
        .where(TolAssignment.case_id == case_id)
        .options(joinedload(TolAssignment.tol_master))
        .order_by(TolAssignment.created_at)
    )
    assignments = result.scalars().all()
    
    return [TolAssignmentResponse.model_validate(a) for a in assignments]


@router.put("/case/{case_id}/assignments/{assignment_id}", response_model=TolAssignmentResponse)
def update_tol_assignment(
    case_id: UUID,
    assignment_id: UUID,
    data: TolAssignmentUpdate,
    db: Session = Depends(get_db)
) -> TolAssignmentResponse:
    """
    Aggiorna una singola assegnazione TOL
    """
    assignment = db.execute(
        select(TolAssignment)
        .where(TolAssignment.id == assignment_id)
        .where(TolAssignment.case_id == case_id)
        .options(joinedload(TolAssignment.tol_master))
    ).scalar_one_or_none()
    
    if not assignment:
        raise HTTPException(status_code=404, detail="Assegnazione non trovata")
    
    if data.weight_percent is not None:
        assignment.weight_percent = data.weight_percent
    if data.amount_allocated is not None:
        assignment.amount_allocated = data.amount_allocated
    if data.notes is not None:
        assignment.notes = data.notes
    
    db.commit()
    db.refresh(assignment)
    
    return TolAssignmentResponse.model_validate(assignment)


@router.delete("/case/{case_id}/assignments/{assignment_id}", status_code=204)
def delete_tol_assignment(
    case_id: UUID,
    assignment_id: UUID,
    db: Session = Depends(get_db)
) -> None:
    """
    Elimina una assegnazione TOL
    """
    result = db.execute(
        select(TolAssignment)
        .where(TolAssignment.id == assignment_id)
        .where(TolAssignment.case_id == case_id)
    )
    assignment = result.scalar_one_or_none()
    
    if not assignment:
        raise HTTPException(status_code=404, detail="Assegnazione non trovata")
    
    db.delete(assignment)
    db.commit()


@router.post("/case/{case_id}/assignments/validate", response_model=TolValidationResponse)
def validate_tol_assignments(
    case_id: UUID,
    db: Session = Depends(get_db)
) -> TolValidationResponse:
    """
    Valida le assegnazioni TOL di una pratica
    
    Verifica:
    - Somma pesi = 100% (se multi-TOL)
    - TOL specializzate hanno precedenza
    - Almeno una TOL assegnata
    """
    assignments = db.execute(
        select(TolAssignment)
        .where(TolAssignment.case_id == case_id)
        .options(joinedload(TolAssignment.tol_master))
    ).scalars().all()
    
    errors = []
    warnings = []
    
    if not assignments:
        errors.append("Nessuna TOL assegnata alla pratica")
        return TolValidationResponse(
            is_valid=False,
            total_weight=0.0,
            errors=errors
        )
    
    total_weight = sum(a.weight_percent for a in assignments)
    
    # Verifica somma pesi
    if len(assignments) > 1:
        if abs(total_weight - 100.0) > 0.01:
            errors.append(
                f"I pesi devono sommarsi a 100% (attuale: {total_weight:.2f}%)"
            )
    
    # Warning per TOL specializzate
    specialized = [a for a in assignments if a.tol_master and a.tol_master.is_specialized]
    if specialized and len(assignments) > 1:
        specialized_names = [a.tol_code for a in specialized]
        warnings.append(
            f"TOL specializzate presenti ({', '.join(specialized_names)}). "
            "Verificare che abbiano priorità nell'assegnazione."
        )
    
    return TolValidationResponse(
        is_valid=len(errors) == 0,
        total_weight=total_weight,
        errors=errors,
        warnings=warnings
    )
