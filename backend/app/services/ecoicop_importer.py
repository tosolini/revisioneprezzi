"""Import descrizioni ECOICOP (2a edizione) da codelist SDMX ISTAT.

Singola fetch della codelist CL_ECOICOP_2 (tutte le ~905 voci in una
risposta), con preferenza alla descrizione italiana. Rispetta il rate
limit ISTAT (5 query/min/IP) come gli altri import SDMX.
"""

import logging
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.models.ecoicop_catalog import EcoicopCatalog

logger = logging.getLogger("ecoicop_import")

CODELIST_ID = "CL_ECOICOP_2"
AGENCY = "IT1"
VERSION = "1.0"
URL = (
    "https://esploradati.istat.it/SDMXWS/rest/codelist"
    f"/{AGENCY}/{CODELIST_ID}/{VERSION}?format=jsonstructure"
)


def _localized_name(item: dict, lang: str = "it") -> str:
    """Estrae il nome nella lingua richiesta (fallback: primo disponibile)."""
    for key in ("names", "name", "description"):
        val = item.get(key)
        if isinstance(val, dict):
            if val.get(lang):
                return str(val[lang])
            for v in val.values():
                if v:
                    return str(v)
        elif isinstance(val, str) and val:
            return val
    return ""


def _extract_codes(payload: Any) -> list[dict[str, str]]:
    found: list[dict[str, str]] = []
    try:
        codelists = payload["data"]["codelists"]
    except (KeyError, TypeError):
        return found
    for cl in codelists if isinstance(codelists, list) else []:
        for item in cl.get("codes", []) or []:
            if not isinstance(item, dict):
                continue
            code = item.get("id")
            if not code:
                continue
            found.append({"code": str(code), "description": _localized_name(item)})
    return found


def import_from_sdmx(db: Session) -> tuple[int, list[str]]:
    """Scarica CL_ECOICOP_2 e fa upsert in ecoicop_catalog.

    Ritorna (n_voci, [codelist_provate]). Solleva RuntimeError se il
    webservice non risponde o non contiene voci.
    """
    try:
        from app.services.sdmx_rate_limit import wait_for_slot

        wait_for_slot()
    except Exception:
        logger.debug("rate limiter non disponibile, proseguo", exc_info=True)

    try:
        resp = httpx.get(
            URL,
            headers={"Accept": "application/vnd.sdmx.structure+json;version=1.0"},
            timeout=httpx.Timeout(120.0, connect=30.0),
        )
    except Exception as e:
        raise RuntimeError(f"webservice ISTAT non raggiungibile: {e}")
    if resp.status_code != 200:
        raise RuntimeError(f"webservice ISTAT: HTTP {resp.status_code}")
    try:
        payload = resp.json()
    except Exception as e:
        raise RuntimeError(f"risposta ISTAT non valida: {e}")

    codes = _extract_codes(payload)
    if not codes:
        raise RuntimeError("codelist CL_ECOICOP_2 vuota o non riconosciuta")

    now = datetime.now(timezone.utc)
    for item in codes:
        existing = (
            db.query(EcoicopCatalog)
            .filter(EcoicopCatalog.ecoicop_code == item["code"])
            .first()
        )
        if existing:
            existing.description = item["description"]
            existing.updated_at = now
        else:
            db.add(
                EcoicopCatalog(
                    ecoicop_code=item["code"],
                    description=item["description"],
                    updated_at=now,
                )
            )
    db.commit()
    return len(codes), [CODELIST_ID]
