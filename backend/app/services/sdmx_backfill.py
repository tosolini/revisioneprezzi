"""Backfill helper per popolare IndexImportQuery da serie esistenti.

Riusa mapping e template già definiti in frontend/src/constants/istatExplorer.ts
e validazione esistente in app.api.v1.indices:_validate_sdmx_url / _save_import_query.

Nessuna tabella nuova, zero nuovi modelli.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.index_series import IndexSeries

# Mirror di frontend/src/constants/istatExplorer.ts — fonte verità per dataflow
DATAFLOW_BY_TYPE: dict[str, str] = {
    "PPI": "145_360_DF_DCSC_PREZZPIND_1_4",
    "PPS": "145_376_DF_DCSC_PREZPRODSERV_1_7",
    "IR": "155_358_DF_DCSC_RETRATECO1_7",
    "PC": "167_744_DF_DCSP_NIC1B2015_1",
}

# classification_ref → ExplorerIndexType (come da spec, con fallback id-prefix)
CLASSIFICATION_TO_EXPLORER: dict[str, str] = {
    "ppi": "PPI",
    "ps_business": "PPS",
    "wages": "IR",
    "wages_ateco": "IR",
    "nic": "PC",
    "nic_ecoicop2": "PC",
}

_WAGES_ATECO_PREFIX = "ISTAT_WAGES_ATECO_"
_ATECO_CLASSIFICATION_REFS = {"ppi", "ps_business", "wages", "wages_ateco"}


def _is_ateco_classification(classification_ref: str | None) -> bool:
    if not classification_ref:
        return False
    if classification_ref in _ATECO_CLASSIFICATION_REFS:
        return True
    if classification_ref.startswith("ATECO"):
        return True
    return False


def _extract_ateco_code(s: IndexSeries) -> str | None:
    """Replica leggera di backend/app/api/v1/indices.py:_extract_ateco_code."""
    sid = s.id
    if not sid.startswith("ISTAT_"):
        return None
    if s.classification_ref:
        prefix = f"ISTAT_{s.classification_ref.upper()}_"
        if sid.startswith(prefix):
            code = sid.removeprefix(prefix)
            if code:
                return code
        if _is_ateco_classification(s.classification_ref):
            if sid.startswith(_WAGES_ATECO_PREFIX):
                code = sid.removeprefix(_WAGES_ATECO_PREFIX)
                if code:
                    return code
            return None
        return None
    if sid.startswith(_WAGES_ATECO_PREFIX):
        code = sid.removeprefix(_WAGES_ATECO_PREFIX)
        if code:
            return code
    return None


def _explorer_for_series(s: IndexSeries) -> str | None:
    """Ritorna ExplorerIndexType per la serie o None se non mappabile."""
    if s.classification_ref and s.classification_ref in CLASSIFICATION_TO_EXPLORER:
        return CLASSIFICATION_TO_EXPLORER[s.classification_ref]
    # fallback per classification custom (ATECO_G ecc.) — ispeziona series.id prefix
    sid = s.id
    if sid.startswith("ISTAT_PPI_"):
        return "PPI"
    if sid.startswith("ISTAT_PS_BUSINESS_"):
        return "PPS"
    if sid.startswith("ISTAT_WAGES_ATECO_") or sid.startswith("ISTAT_WAGES_"):
        return "IR"
    if sid.startswith("ISTAT_NIC_"):
        return "PC"
    if "NIC" in sid:
        return "PC"
    return None


def _code_from_series(s: IndexSeries) -> str | None:
    """Estrae il segmento code URL-ready dalla serie.

    Per PPI con suffisso mercato (0020_D) usa base senza mercato e normalizza
    zeri secondo spec: se base lungo 4 e con leading zero *e* aveva suffisso, strip.
    Per codici senza suffisso (0811, 0181) preserva lo zero.
    Per ps_business/wages_ateco/nic usa code diretto (anche se contiene _).
    """
    raw = _extract_ateco_code(s)
    if not raw:
        return None
    explorer = _explorer_for_series(s)
    # Solo PPI ha suffisso mercato _D/_T/_E da rimuovere; altri mantengono raw integro
    if explorer == "PPI" and "_" in raw:
        base = raw.split("_")[0]
        has_suffix = True
    else:
        base = raw
        has_suffix = False
    if has_suffix and explorer == "PPI" and len(base) == 4 and base.startswith("0"):
        stripped = base.lstrip("0")
        if stripped:
            return stripped
        return base
    if "." in base:
        base = base.replace(".", "")
    return base.strip() if base else None


def build_sdmx_url(s: IndexSeries) -> str | None:
    """Costruisce l'URL SDMX per la serie o None se non mappabile."""
    explorer = _explorer_for_series(s)
    if not explorer:
        return None
    dataflow_id = DATAFLOW_BY_TYPE.get(explorer)
    if not dataflow_id:
        return None
    code = _code_from_series(s)
    if not code:
        return None
    try:
        from app.services.indices_import import _find_dataflow_config  # type: ignore

        cfg = _find_dataflow_config(dataflow_id)
        if cfg is None:
            pass
    except Exception:
        pass

    freq = (s.frequency or "").lower()
    if explorer == "PPS":
        prefix = "Q"
    elif freq == "quarterly":
        prefix = "Q"
    elif freq == "annual":
        prefix = "A"
    else:
        prefix = "M"

    if explorer in ("IR", "PPS"):
        key = f"{prefix}.IT.N.{code}"
    elif explorer == "PC":
        key = f"{prefix}.IT.{code}"
    else:  # PPI
        key = f"{prefix}.IT.{code}"

    return (
        f"https://esploradati.istat.it/SDMXWS/rest/data/IT1,{dataflow_id},1.0/"
        f"{key}/ALL/?detail=full&startPeriod=2024-01-01&endPeriod=2026-03-31"
        f"&dimensionAtObservation=TIME_PERIOD"
    )


def _build_ppi_extended_url(s: IndexSeries, code: str) -> str | None:
    """Variante estesa PPI osservata: M.IT.IND_PRIC_2021.N.D.{code}"""
    dataflow_id = DATAFLOW_BY_TYPE.get("PPI")
    if not dataflow_id:
        return None
    freq = (s.frequency or "").lower()
    prefix = "Q" if freq == "quarterly" else "M"
    key = f"{prefix}.IT.IND_PRIC_2021.N.D.{code}"
    return (
        f"https://esploradati.istat.it/SDMXWS/rest/data/IT1,{dataflow_id},1.0/"
        f"{key}/ALL/?detail=full&startPeriod=2024-01-01&endPeriod=2026-03-31"
        f"&dimensionAtObservation=TIME_PERIOD"
    )


def backfill_for_series(db: Session, series: IndexSeries):  # -> IndexImportQuery | None
    """Valida e salva IndexImportQuery per la singola serie.

    Ritorna la query salvata o None se skip. Solleva HTTPException se validazione fallisce
    in modo recuperabile con variante estesa PPI.
    """
    from app.api.v1.indices import _save_import_query, _validate_sdmx_url

    url = build_sdmx_url(series)
    if not url:
        return None

    normalized = None
    dataflow_id = None
    key_part = None
    last_exc = None
    candidates = [url]
    if _explorer_for_series(series) == "PPI":
        code = _code_from_series(series)
        if code:
            ext = _build_ppi_extended_url(series, code)
            if ext and ext not in candidates:
                candidates.append(ext)

    for cand in candidates:
        try:
            normalized, dataflow_id, key_part = _validate_sdmx_url(cand)
            break
        except Exception as e:  # HTTPException 422
            last_exc = e
            continue

    if normalized is None or dataflow_id is None or key_part is None:
        raise last_exc if last_exc else ValueError("invalid_url")

    _save_import_query(db, normalized, dataflow_id, key_part, [series.id])
    from app.models.index_import_query import IndexImportQuery

    q = db.query(IndexImportQuery).filter(IndexImportQuery.url == normalized).first()
    return q
