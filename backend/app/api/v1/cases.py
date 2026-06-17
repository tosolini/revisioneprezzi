from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.case_file import CaseFile
from app.models.wizard_answer import WizardAnswer
from app.schemas.case import CaseCreate, CaseListResponse, CaseResponse, CaseUpdate

router = APIRouter(prefix="/cases", tags=["cases"])


@router.post("", response_model=CaseResponse, status_code=201)
def create_case(payload: CaseCreate, db: Session = Depends(get_db)):
    case = CaseFile(**payload.model_dump())
    db.add(case)
    db.commit()
    db.refresh(case)
    return case


@router.get("", response_model=list[CaseListResponse])
def list_cases(q: str | None = None, db: Session = Depends(get_db)):
    query = db.query(CaseFile).order_by(CaseFile.created_at.desc())
    if q:
        like = f"%{q}%"
        direct = or_(
            CaseFile.title.ilike(like),
            CaseFile.notes.ilike(like),
            CaseFile.created_by.ilike(like),
        )
        matching = (
            db.query(WizardAnswer.case_id)
            .filter(
                WizardAnswer.step == 1,
                WizardAnswer.field_key.in_(["cig", "operatore_economico", "ente", "cup", "lotto"]),
                WizardAnswer.field_value.ilike(like),
            )
            .distinct()
            .subquery()
        )
        query = query.filter(or_(direct, CaseFile.id.in_(matching)))
    return query.all()


@router.get("/{case_id}", response_model=CaseResponse)
def get_case(case_id: UUID, db: Session = Depends(get_db)):
    case = db.query(CaseFile).filter(CaseFile.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    return case


@router.patch("/{case_id}", response_model=CaseResponse)
def update_case(case_id: UUID, payload: CaseUpdate, db: Session = Depends(get_db)):
    case = db.query(CaseFile).filter(CaseFile.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(case, key, value)
    db.commit()
    db.refresh(case)
    return case


@router.delete("/{case_id}", status_code=204)
def delete_case(case_id: UUID, db: Session = Depends(get_db)):
    case = db.query(CaseFile).filter(CaseFile.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    db.delete(case)
    db.commit()
