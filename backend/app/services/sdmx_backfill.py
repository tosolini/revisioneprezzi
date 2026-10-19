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
    "PC": "167_745_DF_DCSP_NIC1B2025_6",
    "TOL": "145_362_DCSC_INDICITOL_1",
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

# Mapping TOL: serie FABABB (usata dal calcolo) -> codice HOM_TYPE_WORK del dataflow ISTAT TOL.
# Un codice ISTAT per TOL (il più rappresentativo); TOL.3 (scavi archeologici) non ha
# corrispondente ISTAT e resta non mappabile.
TOL_FABABB_TO_ISTAT: dict[str, str] = {
    "FABABB101": "ARC_RES_HE",
    "FABABB102": "BUIL_ART_HEPROT",
    "FABABB103": None,  # type: ignore[dict-item]
    "FABABB104": "EARTDEM_ENV_NAT",
    "FABABB105": "PAV_BITCONG",
    "FABABB106": "STSTRU_ENGWOART",
    "FABABB107": "REINFCONC_ENGWOART",
    "FABABB108": "WOSTR_ENGWOART",
    "FABABB109": "TUN_UND_TRAD",
    "FABABB110": "TUN_UND_MECH",
    "FABABB111": "AC_GAS_IRR_SEW",
    "FABABB112": "MAR_DRED_RIV_PROT",
    "FABABB113": "PLNT_PTD_EEL_HMV_TRPULI",
    "FABABB114": "SYS_EL_TEC_RA_TEL_INT",
    "FABABB115": "SYS_MEC_TER_AIR_WAT_SAN_CON",
    "FABABB116": "PLNT_WAT_PUR_WSTTRE",
    "FABABB117": "SYS_SUG_TRASAF_TEL",
    "FABABB118": "RAIL_INFR",
    "FABABB119": "SPEC_FOUN_GEOL_GEOTH",
    "FABABB120": "DELIV_WASTE_FAC_DIS_REC",
}

# Inverso: codice ISTAT -> serie FABABB (per l'import: salva le osservazioni sotto la serie usata dal calcolo)
TOL_ISTAT_TO_FABABB: dict[str, str] = {
    v: k for k, v in TOL_FABABB_TO_ISTAT.items() if v
}


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
    if sid.startswith("FABABB"):
        return "TOL"
    return None


def _code_from_series(s: IndexSeries) -> str | None:
    """Estrae il segmento code URL-ready dalla serie.

    Per PPI con suffisso mercato (0020_D) usa base senza mercato e normalizza
    zeri secondo spec: se base lungo 4 e con leading zero *e* aveva suffisso, strip.
    Per codici senza suffisso (0811, 0181) preserva lo zero.
    Per ps_business/wages_ateco/nic usa code diretto (anche se contiene _).
    """
    explorer = _explorer_for_series(s)
    if explorer == "TOL":
        return TOL_FABABB_TO_ISTAT.get(s.id)
    raw = _extract_ateco_code(s)
    if not raw:
        return None
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
        # NIC/PC: set nuovo base 2025 (ECOICOP 2) dal 2026-01 —
        # DATA_TYPE 85, MEASURE 4 = numero indice
        key = f"{prefix}.IT.85.4.{code}"
    elif explorer == "TOL":
        key = f"{prefix}.IT.{code}"
    else:  # PPI
        key = f"{prefix}.IT.{code}"

    start = "2026-01-01" if explorer == "PC" else "2024-01-01"
    return (
        f"https://esploradati.istat.it/SDMXWS/rest/data/IT1,{dataflow_id},1.0/"
        f"{key}/ALL/?detail=full&startPeriod={start}&endPeriod=2026-03-31"
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
