"""Lookup batch descrizioni ECOICOP 2 per series_id NIC.

Unico punto di verità per la risoluzione
ISTAT_NIC_ECOICOP2_<codice> -> EcoicopCatalog.description
(zero N+1, nessuna chiamata ISTAT a runtime).
"""

from sqlalchemy.orm import Session

from app.models.ecoicop_catalog import EcoicopCatalog

NIC_ECOICOP_PREFIX = "ISTAT_NIC_ECOICOP2_"


def ecoicop_labels_for_series_ids(db: Session, series_ids: list[str]) -> dict[str, str]:
    """Mapping series_id -> descrizione per le serie NIC presenti a catalogo."""
    codes = {
        sid.removeprefix(NIC_ECOICOP_PREFIX)
        for sid in series_ids
        if sid.startswith(NIC_ECOICOP_PREFIX)
    }
    if not codes:
        return {}
    rows = (
        db.query(EcoicopCatalog).filter(EcoicopCatalog.ecoicop_code.in_(list(codes))).all()
    )
    by_code = {r.ecoicop_code: r.description for r in rows}
    return {
        sid: by_code[code]
        for sid in series_ids
        if sid.startswith(NIC_ECOICOP_PREFIX)
        and (code := sid.removeprefix(NIC_ECOICOP_PREFIX)) in by_code
    }
