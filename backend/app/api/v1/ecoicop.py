from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.ecoicop_catalog import EcoicopCatalog

router = APIRouter(prefix="/ecoicop", tags=["ecoicop"])


def _payload(r: EcoicopCatalog) -> dict:
    return {"code": r.ecoicop_code, "description": r.description}


@router.get("")
@router.get("/")
def list_ecoicop(
    q: str | None = Query(None),
    limit: int = Query(50, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """Elenca voci ECOICOP 2 (codice + descrizione italiana ISTAT)."""
    query = db.query(EcoicopCatalog).order_by(EcoicopCatalog.ecoicop_code)
    if q and q.strip():
        search = f"%{q.strip()}%"
        query = query.filter(
            or_(
                EcoicopCatalog.ecoicop_code.ilike(search),
                EcoicopCatalog.description.ilike(search),
            )
        )
    results = query.limit(limit).offset(offset).all()
    return {
        "results": [_payload(r) for r in results],
        "has_more": len(results) == limit,
        "limit": limit,
        "offset": offset,
    }


@router.get("/{code}")
def get_ecoicop(code: str, db: Session = Depends(get_db)):
    entry = db.query(EcoicopCatalog).filter(EcoicopCatalog.ecoicop_code == code).first()
    if not entry:
        return {"code": code, "description": None}
    return _payload(entry)


@router.post("/import")
def import_ecoicop(db: Session = Depends(get_db)):
    """Importa la codelist CL_ECOICOP_2 da ISTAT (singola chiamata).

    Va eseguito una volta (e al cambio base); le label sono poi servite
    dal DB senza altre chiamate al webservice.
    """
    from app.services.ecoicop_importer import import_from_sdmx

    try:
        imported, tried = import_from_sdmx(db)
    except ProgrammingError as e:
        raise HTTPException(
            status_code=500,
            detail=f"Errore database: tabella ecoicop_catalog non trovata. Eseguire 'alembic upgrade head'. {e}",  # noqa: E501
        )
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Errore durante import: {e}")
    return {"imported": imported, "tried": tried}
