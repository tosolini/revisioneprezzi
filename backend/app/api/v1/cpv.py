from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.cpv_catalog import CpvCatalog

router = APIRouter(prefix="/cpv", tags=["cpv"])


@router.get("")
@router.get("/")
def list_cpv(q: str | None = Query(None), limit: int = Query(50, ge=1, le=1000), offset: int = Query(0, ge=0), db: Session = Depends(get_db)):
    if q and q.strip():
        search = f"%{q}%"
        results = (
            db.query(CpvCatalog)
            .filter(or_(CpvCatalog.cpv_code.ilike(search), CpvCatalog.description.ilike(search)))
            .order_by(CpvCatalog.cpv_code)
            .limit(limit)
            .offset(offset)
            .all()
        )
    else:
        results = (
            db.query(CpvCatalog)
            .order_by(CpvCatalog.cpv_code)
            .limit(limit)
            .offset(offset)
            .all()
        )
    return {"results": [{"code": r.cpv_code, "description": r.description} for r in results], "has_more": len(results) == limit, "limit": limit, "offset": offset}


@router.get("/search")
def search_cpv(q: str = Query("", min_length=1), db: Session = Depends(get_db)):
    if not q:
        return {"results": []}
    search = f"%{q}%"
    results = (
        db.query(CpvCatalog)
        .filter(or_(CpvCatalog.cpv_code.ilike(search), CpvCatalog.description.ilike(search)))
        .order_by(CpvCatalog.cpv_code)
        .limit(50)
        .all()
    )
    return {
        "results": [
            {"code": r.cpv_code, "description": r.description}
            for r in results
        ]
    }


@router.post("/import-zip")
def import_cpv_zip(file: UploadFile = File(...), db: Session = Depends(get_db)):
    from app.services.cpv_importer import import_from_zip_bytes

    if not file.filename or not file.filename.lower().endswith('.zip'):
        raise HTTPException(status_code=400, detail="Il file deve essere un archivio ZIP")

    try:
        from app.core.uploads import read_upload_limited
        contents = read_upload_limited(file)
        imported, source = import_from_zip_bytes(db, contents)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Errore durante import da file: {e}")
    finally:
        file.file.close()

    return {"imported": imported, "source": source}


@router.get('/import_status')
def import_status():
    from pathlib import Path
    import json
    status_file = Path(__file__).resolve().parents[1] / 'data' / 'cpv_import_status.json'
    if not status_file.exists():
        return {"last_imported_at": None}
    try:
        with status_file.open('r', encoding='utf-8') as f:
            obj = json.load(f)
        return obj
    except Exception:
        return {"last_imported_at": None}


@router.get("/{code}")
def get_cpv(code: str, db: Session = Depends(get_db)):
    entry = db.query(CpvCatalog).filter(CpvCatalog.cpv_code == code).first()
    if not entry:
        return {"code": code, "description": None}
    return {"code": entry.cpv_code, "description": entry.description}
