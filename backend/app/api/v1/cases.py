from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
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
            CaseFile.cig.ilike(like),
        )
        matching = (
            db.query(WizardAnswer.case_id)
            .filter(
                WizardAnswer.step.in_([0, 1]),
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
    return Response(status_code=204)


class PracticeMetaSave(BaseModel):
    lotto: str | None = None
    operatore_economico: str | None = None


@router.get("/{case_id}/practice-meta")
def get_practice_meta(case_id: UUID, db: Session = Depends(get_db)):
    """Lotto/operatore della pratica (KV step 0, fallback step 1 legacy)."""
    case = db.query(CaseFile).filter(CaseFile.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    rows = {
        (a.step, a.field_key): (a.field_value or "")
        for a in db.query(WizardAnswer)
        .filter(
            WizardAnswer.case_id == case_id,
            WizardAnswer.step.in_([0, 1]),
            WizardAnswer.field_key.in_(["lotto", "operatore_economico"]),
        )
        .all()
    }
    return {
        "lotto": rows.get((0, "lotto")) or rows.get((1, "lotto")) or None,
        "operatore_economico": rows.get((0, "operatore_economico"))
        or rows.get((1, "operatore_economico"))
        or None,
    }


@router.put("/{case_id}/practice-meta")
def save_practice_meta(case_id: UUID, payload: PracticeMetaSave, db: Session = Depends(get_db)):
    """Scrive lotto/operatore come righe KV step 0 (modale pratica, non wizard).

    Upsert per chiave; stringa vuota/None cancella la riga. Non tocca
    wizard_version né current_step: il modale non è un percorso wizard.
    """
    case = db.query(CaseFile).filter(CaseFile.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    for key, value in (
        ("lotto", payload.lotto),
        ("operatore_economico", payload.operatore_economico),
    ):
        row = (
            db.query(WizardAnswer)
            .filter(
                WizardAnswer.case_id == case_id,
                WizardAnswer.step == 0,
                WizardAnswer.field_key == key,
            )
            .first()
        )
        text = (value or "").strip()
        if not text:
            if row:
                db.delete(row)
            continue
        if row:
            row.field_value = text
        else:
            db.add(
                WizardAnswer(
                    case_id=case_id,
                    step=0,
                    field_key=key,
                    field_value=text,
                )
            )
    db.commit()
    return get_practice_meta(case_id, db)


@router.post("/delete-drafts")
def delete_draft_cases(db: Session = Depends(get_db)):
    """Elimina in blocco le pratiche lasciate in bozza (status 'draft')."""
    drafts = db.query(CaseFile).filter(CaseFile.status == "draft").all()
    count = len(drafts)
    for case in drafts:
        db.delete(case)
    db.commit()
    return {"deleted": count}
