from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.case_file import CaseFile
from app.services.audit_service import log_event
from app.services.report_service import generate_report

router = APIRouter(tags=["report"])


@router.post("/cases/{case_id}/report")
def generate_case_report(case_id: UUID, db: Session = Depends(get_db)):
    case = db.query(CaseFile).filter(CaseFile.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    try:
        report = generate_report(case_id, db)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    log_event(
        db,
        "report_generated",
        case_id=case_id,
        payload={"format": "markdown"},
        commit=True,
    )

    return {"report": report, "format": "markdown"}
