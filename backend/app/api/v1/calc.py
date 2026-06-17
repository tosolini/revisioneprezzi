from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.case_file import CaseFile
from app.models.revision_result import RevisionResult
from app.services.audit_service import log_event
from app.services.calculation_service import (
    calculate_composite,
    calculate_single,
    save_result,
)

router = APIRouter(prefix="/calculate", tags=["calculation"])


class CompositeComponent(BaseModel):
    series_id: str
    weight: float = Field(gt=0, le=100)


class CompositeCalcRequest(BaseModel):
    components: list[CompositeComponent]
    base_period: date
    comparison_period: date
    amount: float = Field(gt=0)


class FullCalcRequest(BaseModel):
    case_id: UUID
    series_id: str
    base_period: date
    comparison_period: date
    amount: float = Field(gt=0)
    user_id: str | None = None


@router.post("")
def calculate(payload: FullCalcRequest, db: Session = Depends(get_db)):
    case = db.query(CaseFile).filter(CaseFile.id == payload.case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    result = calculate_single(
        db=db,
        series_id=payload.series_id,
        base_period=payload.base_period,
        comparison_period=payload.comparison_period,
        amount=payload.amount,
    )

    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    last = (
        db.query(RevisionResult)
        .filter(RevisionResult.case_id == payload.case_id)
        .order_by(RevisionResult.result_version.desc())
        .first()
    )
    next_version = (last.result_version + 1) if last else 1

    record = save_result(db, payload.case_id, result, version=next_version)

    log_event(
        db,
        "calculation_executed",
        case_id=payload.case_id,
        user_id=payload.user_id,
        payload={
            "series_id": payload.series_id,
            "base_period": payload.base_period.isoformat(),
            "comparison_period": payload.comparison_period.isoformat(),
            "amount": payload.amount,
            "result_version": next_version,
        },
        commit=False,
    )
    db.commit()

    return {
        **result,
        "result_version": next_version,
        "result_id": str(record.id),
    }


@router.post("/composite")
def calculate_composite_endpoint(
    payload: CompositeCalcRequest, db: Session = Depends(get_db)
):
    result = calculate_composite(
        db=db,
        components=[c.model_dump() for c in payload.components],
        base_period=payload.base_period,
        comparison_period=payload.comparison_period,
        amount=payload.amount,
    )
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result
