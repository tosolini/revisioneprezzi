from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.classification_service import classify
from app.services.index_selection_service import get_candidate_series

router = APIRouter(prefix="/classify", tags=["classification"])


class ClassifyRequest(BaseModel):
    cpv_primary: str
    contract_type: str | None = None
    labour_intensive: bool | None = None
    instant_execution: bool | None = None


@router.post("")
def classify_endpoint(payload: ClassifyRequest, db: Session = Depends(get_db)):
    result = classify(
        cpv_primary=payload.cpv_primary,
        db=db,
        contract_type=payload.contract_type,
        labour_intensive=payload.labour_intensive,
        instant_execution=payload.instant_execution,
    )
    return result


class IndexRequest(BaseModel):
    family: str


@router.post("/indices")
def get_indices_for_family(payload: IndexRequest, db: Session = Depends(get_db)):
    series = get_candidate_series(family=payload.family, db=db)
    return {"family": payload.family, "candidate_series": series}


class CpvIndexRequest(BaseModel):
    cpv_primary: str
    contract_type: str | None = None
    labour_intensive: bool | None = None
    instant_execution: bool | None = None


@router.post("/indices-for-cpv")
def get_indices_for_cpv(payload: CpvIndexRequest, db: Session = Depends(get_db)):
    result = classify(
        cpv_primary=payload.cpv_primary,
        db=db,
        contract_type=payload.contract_type,
        labour_intensive=payload.labour_intensive,
        instant_execution=payload.instant_execution,
    )
    candidates = result.get("candidates", [])
    series_list = []
    for c in candidates:
        family = c.get("family")
        if family:
            series = get_candidate_series(family=family, db=db)
            series_list.extend(series)
    seen = {}
    for s in series_list:
        if s["id"] not in seen:
            seen[s["id"]] = s
    return {
        "cpv_primary": payload.cpv_primary,
        "candidates": list(seen.values()),
        "requires_human_intervention": result.get("requires_human_intervention", False),
        "warnings": result.get("warnings", []),
    }
