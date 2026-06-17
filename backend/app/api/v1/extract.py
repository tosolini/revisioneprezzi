from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.case_file import CaseFile
from app.models.wizard_answer import WizardAnswer

router = APIRouter(prefix="/cases/{case_id}", tags=["extract"])

PARSER_URL = "http://parser:8002"

STEP_KEYS: dict[int, set[str]] = {
    1: {"ente", "cig", "cup", "operatore_economico", "object_description"},
    2: {"contract_type", "stipulation_date", "duration_months", "contract_amount_total"},
    3: {"cpv_primary"},
}


def get_step_keys(step: int) -> set[str]:
    return STEP_KEYS.get(step, set())


@router.post("/extract")
def extract_document(case_id: UUID, file: UploadFile = File(...), db: Session = Depends(get_db)):
    case = db.query(CaseFile).filter(CaseFile.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    if not file.filename:
        raise HTTPException(status_code=400, detail="Nessun file fornito")

    from app.core.uploads import read_upload_limited
    contents = read_upload_limited(file)

    with httpx.Client(timeout=60) as client:
        resp = client.post(
            f"{PARSER_URL}/extract",
            files={"file": (file.filename, contents, file.content_type or "application/octet-stream")},
        )

    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Parser error: {resp.text}")

    data = resp.json()
    fields = data.get("fields", {})

    wizard_data: dict[str, str] = {}
    field_map = {
        "ente": "ente",
        "cig": "cig",
        "cup": "cup",
        "oggetto": "object_description",
        "cpv_primary": "cpv_primary",
        "importo_complessivo": "contract_amount_total",
        "durata_mesi": "duration_months",
        "natura": "contract_type",
        "data_stipula": "stipulation_date",
        "operatore_economico": "operatore_economico",
    }

    for parser_key, wizard_key in field_map.items():
        val = fields.get(parser_key)
        if val is not None:
            wizard_data[wizard_key] = str(val)

    if wizard_data.get("contract_type"):
        natura_map = {"servizio": "service", "fornitura": "supply", "misto": "mixed", "lavori": "works"}
        mapped = natura_map.get(wizard_data["contract_type"].lower())
        if mapped:
            wizard_data["contract_type"] = mapped

    for step in range(1, 9):
        step_data = {k: v for k, v in wizard_data.items() if k in get_step_keys(step)}
        if step_data:
            case.current_step = step
            for key, value in step_data.items():
                answer = WizardAnswer(case_id=case_id, step=step, field_key=key, field_value=value)
                db.add(answer)
    db.commit()

    return {"fields": fields, "applied": wizard_data}
