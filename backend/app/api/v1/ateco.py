from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import or_
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.ateco_catalog import AtecoCatalog

router = APIRouter(prefix="/ateco", tags=["ateco"])


@router.get("")
@router.get("/")
def list_ateco(q: str | None = Query(None), limit: int = Query(50, ge=1, le=1000), offset: int = Query(0, ge=0), db: Session = Depends(get_db)):
    """List ATECO entries. If `q` is provided, performs a case-insensitive search on code or description.
    Returns results and a simple has_more flag for pagination.
    """
    if q and q.strip():
        search = f"%{q}%"
        results = (
            db.query(AtecoCatalog)
            .filter(or_(AtecoCatalog.ateco_code.ilike(search), AtecoCatalog.description.ilike(search)))
            .order_by(AtecoCatalog.ateco_code)
            .limit(limit)
            .offset(offset)
            .all()
        )
    else:
        results = (
            db.query(AtecoCatalog)
            .order_by(AtecoCatalog.ateco_code)
            .limit(limit)
            .offset(offset)
            .all()
        )
    return {
        "results": [{"code": r.ateco_code, "description": r.description} for r in results],
        "has_more": len(results) == limit,
        "limit": limit,
        "offset": offset,
    }


@router.get("/search")
def search_ateco(q: str = Query("", min_length=1), db: Session = Depends(get_db)):
    if not q:
        return {"results": []}
    search = f"%{q}%"
    results = (
        db.query(AtecoCatalog)
        .filter(or_(AtecoCatalog.ateco_code.ilike(search), AtecoCatalog.description.ilike(search)))
        .order_by(AtecoCatalog.ateco_code)
        .limit(50)
        .all()
    )
    return {
        "results": [
            {"code": r.ateco_code, "description": r.description}
            for r in results
        ]
    }


@router.post("/import")
def import_ateco(agency: str = "IT1", artifact_id: str | None = None, version: str = "1.0", force: bool = False, ttl_hours: int = 24, db: Session = Depends(get_db)):
    """Importa codelist ATECO da SDMX ISTAT. Restituisce conteggio elementi importati e lista di id provati.

    - force: se True ignora la cache locale e forza il fetch remoto
    - ttl_hours: validità cache in ore
    """
    from app.services.ateco_importer import import_from_sdmx

    use_cache = not force
    ttl_seconds = int(ttl_hours) * 3600
    try:
        imported, tried = import_from_sdmx(db, agency=agency, artifact_id=artifact_id, version=version, use_cache=use_cache, ttl_seconds=ttl_seconds)
    except ProgrammingError as e:
        raise HTTPException(status_code=500, detail=f"Errore database: tabella ateco_catalog non trovata. Eseguire 'alembic upgrade head'. {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Errore durante import: {e}")
    return {"imported": imported, "tried": tried}


@router.post("/import-zip")
def import_ateco_zip(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Importa codelist ATECO da file ZIP scaricato dal sito ISTAT.
    Il ZIP deve contenere un file XML con la struttura ATECO 2025.
    """
    from app.services.ateco_importer import import_from_zip

    if not file.filename or not file.filename.lower().endswith('.zip'):
        raise HTTPException(status_code=400, detail="Il file deve essere un archivio ZIP")

    try:
        from app.core.uploads import read_upload_limited
        contents = read_upload_limited(file)
        imported = import_from_zip(db, contents)
    except ProgrammingError as e:
        raise HTTPException(status_code=500, detail=f"Errore database: tabella ateco_catalog non trovata. Eseguire 'alembic upgrade head'. {e}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Errore durante import da file: {e}")
    finally:
        file.file.close()

    return {"imported": imported, "source": file.filename}


@router.get('/cache_status')
def cache_status(agency: str = 'IT1', version: str = '1.0'):
    """Return cache metadata for known ATECO candidates (fetched_at or null)."""
    import json
    from pathlib import Path

    candidates = ["ATECO2025", "ATECO", "ATECO2022", "CL_ACT", "CL_ATECO", "ACT"]  # primary first, then fallbacks
    cache_dir = Path(__file__).resolve().parents[1] / 'data' / 'sdmx_cache'
    out = []
    for cand in candidates:
        safe_name = f"{agency}_{cand}_{version}".replace('/', '_')
        p = cache_dir / f"{safe_name}.json"
        info = None
        if p.exists():
            try:
                with p.open('r', encoding='utf-8') as f:
                    obj = json.load(f)
                fetched = obj.get('fetched_at')
                info = fetched
            except Exception:
                info = None
        out.append({'id': cand, 'fetched_at': info})
    return {'candidates': out}


@router.get("/last-import")
def last_import(db: Session = Depends(get_db)):
    entry = db.query(AtecoCatalog).order_by(AtecoCatalog.updated_at.desc()).first()
    if not entry:
        return {"last_import_at": None}
    return {"last_import_at": entry.updated_at.isoformat() if entry.updated_at else None}


@router.get("/{code}")
def get_ateco(code: str, db: Session = Depends(get_db)):
    entry = db.query(AtecoCatalog).filter(AtecoCatalog.ateco_code == code).first()
    if not entry:
        return {"code": code, "description": None}
    return {"code": entry.ateco_code, "description": entry.description}

