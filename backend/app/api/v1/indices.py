import json
import logging
import re
import time
import urllib.parse
import uuid
from datetime import datetime, timezone
from math import ceil

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, field_validator
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.ateco_catalog import AtecoCatalog
from app.models.index_import_query import IndexImportQuery, IndexImportQuerySeries
from app.models.index_observation import IndexObservation
from app.models.index_series import IndexSeries
from app.models.tabella_d import CpvTabellaDAssociation
from app.services.indices_import import _load_dataflow_configs, import_sdmx_content
from app.services.sdmx_rate_limit import RateLimitTimeout, wait_for_slot
from app.services import sdmx_backfill, sdmx_import_jobs
from app.services.audit_service import log_event
from app.services.sdmx_url_utils import resolve_sdmx_url_dates_both

router = APIRouter(prefix="/indices", tags=["indices"])

SDMX_ALLOWED_HOST = "esploradati.istat.it"
SDMX_DATA_PATH_PREFIX = "/SDMXWS/rest/data/"
SDMX_MAX_RESPONSE_BYTES = 20 * 1024 * 1024  # specchia il cap degli upload
SDMX_FETCH_TIMEOUT = httpx.Timeout(300.0, connect=30.0)
# L'import gira in background (job): il budget copre anche le query
# tutti-wildcard che Istat impiega 5-6 minuti (a volte più) a risolvere.
SDMX_FETCH_TOTAL_BUDGET = 600.0
SDMX_PROBE_BUDGET = 45.0  # probe: esistenza dati, niente retry

_WAGES_ATECO_PREFIX = "ISTAT_WAGES_ATECO_"
_ATECO_CLASSIFICATION_REFS = {"ppi", "ps_business", "wages", "wages_ateco"}


def _is_ateco_classification(classification_ref: str | None) -> bool:
    """True se la serie usa codici ATECO (lookup AtecoCatalog ha senso)."""
    if not classification_ref:
        return False
    if classification_ref in _ATECO_CLASSIFICATION_REFS:
        return True
    # gruppi dinamici ATECO_* / ATECOC_* creati da import SDMX wildcards
    if classification_ref.startswith("ATECO"):
        return True
    return False


def _extract_ateco_code(s: IndexSeries) -> str | None:
    """Estrae il codice ATECO dal series.id per lookup in AtecoCatalog.

    Gestisce tutti gli indici ISTAT (non solo wages_ateco):
    - Se classification_ref è noto, usa prefix ISTAT_{CLASS}_
    - Fallback sul prefix WAGES_ATECO per retrocompatibilità
    - Per id non-ISTAT o non-ATECO ritorna None
    """
    sid = s.id
    if not sid.startswith("ISTAT_"):
        return None
    # prefix basato su classification_ref (es. ISTAT_PPI_, ISTAT_PS_BUSINESS_, ISTAT_WAGES_ATECO_)
    if s.classification_ref:
        prefix = f"ISTAT_{s.classification_ref.upper()}_"
        if sid.startswith(prefix):
            code = sid.removeprefix(prefix)
            if code:
                return code
        # Se classification è ATECO ma id non segue prefix canonico, non forzare
        if _is_ateco_classification(s.classification_ref):
            # prova anche fallback generico wages
            if sid.startswith(_WAGES_ATECO_PREFIX):
                code = sid.removeprefix(_WAGES_ATECO_PREFIX)
                if code:
                    return code
            return None
        return None
    # senza classification_ref: prova solo prefix noto wages (legacy)
    if sid.startswith(_WAGES_ATECO_PREFIX):
        code = sid.removeprefix(_WAGES_ATECO_PREFIX)
        if code:
            return code
    return None


def _code_variants(code: str) -> list[str]:
    """Varianti normalizzate per lookup AtecoCatalog (punti, suffissi mercato, zeri)."""
    variants: list[str] = [code]
    if "." in code:
        v = code.replace(".", "")
        if v not in variants:
            variants.append(v)
    if "_" in code:
        base = code.split("_")[0]
        if base not in variants:
            variants.append(base)
        if "." in base:
            b2 = base.replace(".", "")
            if b2 not in variants:
                variants.append(b2)
        stripped = base.lstrip("0")
        if stripped and stripped not in variants:
            variants.append(stripped)
        if stripped and "." in stripped:
            s2 = stripped.replace(".", "")
            if s2 not in variants:
                variants.append(s2)
    else:
        stripped = code.lstrip("0")
        if stripped and stripped not in variants and stripped != code:
            variants.append(stripped)
    return variants


def _ateco_labels_for_wages(db: Session, series_list: list[IndexSeries]) -> dict[str, str | None]:
    """Ritorna mapping series.id -> ateco_label per serie ISTAT con codici ATECO.

    Esteso da wages_ateco a tutti gli indici ISTAT con classificazione ATECO
    (ppi, ps_business, wages, wages_ateco, ATECO_*). Lookup in due passi (zero N+1):
    1) AtecoCatalog (descrizione ufficiale)
    2) CpvTabellaDAssociation.index_description come fallback (copre 951 anche a DB ATECO vuoto)
    Se ateco_catalog vuoto o codice non trovato, label resta None (nessun errore).
    """
    if not series_list:
        return {}
    # Raccogli codici ATECO dai series_id ISTAT con classificazione ATECO
    codes_by_series: dict[str, str] = {}
    codes_set: set[str] = set()
    for s in series_list:
        code = _extract_ateco_code(s)
        if code is None:
            continue
        # solo se la classificazione è ATECO (evita ECOICOP 01 che colliderebbe con ATECO 01)
        if s.classification_ref and not _is_ateco_classification(s.classification_ref):
            continue
        # per id senza classification ma con prefix wages, è per definizione ATECO
        codes_by_series[s.id] = code
        codes_set.add(code)
    if not codes_set:
        return {}
    all_query_codes: set[str] = set()
    for c in codes_set:
        for v in _code_variants(c):
            all_query_codes.add(v)
    ateco_map: dict[str, str] = {}
    try:
        rows = (
            db.query(AtecoCatalog).filter(AtecoCatalog.ateco_code.in_(list(all_query_codes))).all()
        )
        for r in rows:
            ateco_map[r.ateco_code] = r.description
    except Exception:
        ateco_map = {}
    # Fallback Tabella D per codici ancora mancanti
    # Costruisci mappa code -> label risolvendo anche variante normalizzata
    series_label: dict[str, str | None] = {}
    still_missing_codes: set[str] = set()
    for sid, code in codes_by_series.items():
        label = None
        for v in _code_variants(code):
            label = ateco_map.get(v)
            if label:
                break
        if label is not None:
            series_label[sid] = label
        else:
            still_missing_codes.add(code)
            series_label[sid] = None
    if still_missing_codes:
        # lookup distinto su Tabella D
        missing_query_codes: set[str] = set()
        for c in still_missing_codes:
            for v in _code_variants(c):
                missing_query_codes.add(v)
        try:
            assoc_rows = (
                db.query(
                    CpvTabellaDAssociation.ateco_code,
                    CpvTabellaDAssociation.index_description,
                )
                .filter(CpvTabellaDAssociation.ateco_code.in_(list(missing_query_codes)))
                .all()
            )
            assoc_map: dict[str, str] = {}
            for acode, descr in assoc_rows:
                if acode not in assoc_map and descr:
                    assoc_map[acode] = descr
            for sid, code in codes_by_series.items():
                if series_label.get(sid) is not None:
                    continue
                fallback = None
                for v in _code_variants(code):
                    fallback = assoc_map.get(v)
                    if fallback:
                        break
                if fallback:
                    series_label[sid] = fallback
        except Exception:
            pass
    return series_label


class SdmxNoRecordsError(Exception):
    """Istat ha risposto 404 NoRecordsFound: chiave valida ma nessun dato."""


@router.get("")
def list_indices(db: Session = Depends(get_db)):
    series = db.query(IndexSeries).order_by(IndexSeries.name).all()
    return [
        {
            "id": s.id,
            "name": s.name,
            "source": s.source,
            "normative_category": s.normative_category,
            "classification_ref": s.classification_ref,
            "frequency": s.frequency,
        }
        for s in series
    ]


@router.get("/search")
def search_indices(q: str = "", group: str = "", db: Session = Depends(get_db)):
    query = db.query(IndexSeries)
    if q:
        search_term = f"%{q}%"
        query = query.filter(
            or_(
                IndexSeries.id.ilike(search_term),
                IndexSeries.name.ilike(search_term),
                IndexSeries.normative_category.ilike(search_term),
            )
        )
    if group:
        query = query.filter(IndexSeries.classification_ref == group)
    series = query.order_by(IndexSeries.name).limit(100).all()
    # Estensione: se q contiene termini descrittivi ATECO
    # (es. "Riparazione", "Telecomunicazioni", "prodotti chimici"),
    # la base id/name non trova nulla perché ateco_label è derivato
    # da AtecoCatalog. Cerca anche lì.
    if q and len(series) < 100:
        search_term_ateco = f"%{q}%"
        ateco_codes: set[str] = set()
        try:
            rows = (
                db.query(AtecoCatalog.ateco_code)
                .filter(
                    AtecoCatalog.description.ilike(search_term_ateco)
                )
                .limit(200)
                .all()
            )
            for (c,) in rows:
                ateco_codes.add(c)
            rows2 = (
                db.query(CpvTabellaDAssociation.ateco_code)
                .filter(
                    CpvTabellaDAssociation.index_description.ilike(
                        search_term_ateco
                    )
                )
                .limit(200)
                .all()
            )
            for (c,) in rows2:
                ateco_codes.add(c)
        except Exception:
            ateco_codes = set()
        if ateco_codes:
            existing_ids = {s.id for s in series}
            # candidati: solo classificazioni ATECO (evita ECOICOP)
            cand_query = db.query(IndexSeries)
            if group:
                cand_query = cand_query.filter(IndexSeries.classification_ref == group)
            else:
                # filtra a classificazioni ATECO per evitare di scannerizzare tutto
                cand_query = cand_query.filter(
                    or_(
                        IndexSeries.classification_ref.in_(list(_ATECO_CLASSIFICATION_REFS)),
                        IndexSeries.classification_ref.like("ATECO%"),
                        IndexSeries.id.like("ISTAT_WAGES_ATECO_%"),
                        IndexSeries.id.like("ISTAT_PPI_%"),
                        IndexSeries.id.like("ISTAT_PS_BUSINESS_%"),
                    )
                )
            candidates = cand_query.all()
            for s in candidates:
                if s.id in existing_ids:
                    continue
                code = _extract_ateco_code(s)
                if code is None:
                    continue
                # confronta varianti del codice serie con i codici ATECO trovati
                matched = False
                for v in _code_variants(code):
                    if v in ateco_codes:
                        matched = True
                        break
                # anche match inverso: codice ATECO potrebbe avere varianti (es. 0020 vs 20)
                if not matched:
                    for ac in ateco_codes:
                        for av in _code_variants(ac):
                            if av == code or av in _code_variants(code):
                                matched = True
                                break
                        if matched:
                            break
                if matched:
                    series.append(s)
                    existing_ids.add(s.id)
                    if len(series) >= 100:
                        break
            # riordina per nome e limita
            series = sorted(series, key=lambda x: x.name)[:100]
    saved_by_series = _latest_saved_queries(db, [s.id for s in series])
    ateco_labels = _ateco_labels_for_wages(db, series)
    return [
        {
            "id": s.id,
            "name": s.name,
            "source": s.source,
            "normative_category": s.normative_category,
            "classification_ref": s.classification_ref,
            "frequency": s.frequency,
            "saved_query": _saved_query_payload(saved_by_series.get(s.id)),
            "ateco_label": ateco_labels.get(s.id),
        }
        for s in series
    ]


class ObservationCreate(BaseModel):
    series_id: str
    ref_period: str
    value: float
    is_definitive: bool = False
    notes: str | None = None


@router.post("/observations", status_code=201)
def add_observation(payload: ObservationCreate, db: Session = Depends(get_db)):
    obs = IndexObservation(
        series_id=payload.series_id,
        ref_period=payload.ref_period,
        value=payload.value,
        is_definitive=payload.is_definitive,
        notes=payload.notes,
    )
    db.add(obs)
    db.commit()
    db.refresh(obs)
    return obs


class SdmxImportRequest(BaseModel):
    url: str
    end_period_strategy: str | None = None
    start_period_strategy: str | None = None


def _validate_sdmx_url(raw: str) -> tuple[str, str, str]:
    """Valida un URL dati SDMX Istat e ritorna (url normalizzato, dataflow_id,
    chiave con le posizioni dimensionali)."""
    try:
        parsed = urllib.parse.urlsplit(raw.strip())
    except ValueError:
        raise HTTPException(422, "URL non valido")
    if parsed.scheme != "https":
        raise HTTPException(422, "Sono ammessi solo URL https")
    if (parsed.hostname or "").lower() != SDMX_ALLOWED_HOST:
        raise HTTPException(
            422, f"Sono ammessi solo URL del webservice Istat ({SDMX_ALLOWED_HOST})"
        )
    if not parsed.path.startswith(SDMX_DATA_PATH_PREFIX):
        raise HTTPException(422, "Sono ammesse solo query dati SDMX (/SDMXWS/rest/data/...)")
    m = re.match(r"^/SDMXWS/rest/data/([^/]+)/([^/]+)/", parsed.path)
    if not m:
        raise HTTPException(422, "URL dati SDMX non riconosciuto")
    flow_part, key_part = m.group(1), m.group(2)
    dataflow_id = next((t for t in flow_part.split(",") if "_" in t), None)
    if not dataflow_id:
        raise HTTPException(422, "Impossibile estrarre il dataflow dall'URL")

    params = dict(urllib.parse.parse_qsl(parsed.query, keep_blank_values=True))
    params["format"] = "csv"
    params.setdefault("dimensionAtObservation", "TIME_PERIOD")
    normalized = urllib.parse.urlunsplit(
        (parsed.scheme, parsed.netloc, parsed.path, urllib.parse.urlencode(params), "")
    )
    return normalized, dataflow_id, key_part


def _saved_query_payload(
    q: IndexImportQuery | None, series_count: int | None = None
) -> dict | None:
    """Payload della query salvata: forma breve per le serie, completa per il CRUD.

    None per serie senza query salvata."""
    if q is None:
        return None
    payload = {
        "id": str(q.id),
        "url": q.url,
        "dataflow_id": q.dataflow_id,
        "key_part": q.key_part,
        "created_at": q.created_at.isoformat() if q.created_at else None,
        "end_period_strategy": getattr(q, "end_period_strategy", "last_month_end")
        or "last_month_end",
        "start_period_strategy": getattr(q, "start_period_strategy", "fixed") or "fixed",
    }
    if series_count is not None:
        payload["last_run_at"] = q.last_run_at.isoformat() if q.last_run_at else None
        payload["series_count"] = series_count
    else:
        # per CRUD completo includi last_run_at anche senza count
        payload["last_run_at"] = q.last_run_at.isoformat() if q.last_run_at else None
    return payload


def _save_import_query(
    db: Session,
    url: str,
    dataflow_id: str,
    key_part: str,
    series_ids: list[str],
    end_period_strategy: str | None = None,
    start_period_strategy: str | None = None,
) -> None:
    """Salva (o aggiorna) la query SDMX appena importata e i link alle serie.

    Una riga per URL normalizzata: i run successivi riusano la stessa riga
    aggiornando `last_run_at`. Idempotente: stessa query → stessi link
    (delete + reinsert). Il parser committa già da solo; qui un solo commit."""
    now = datetime.now(timezone.utc)
    # valida/normalizza strategie - non modificare endPeriod logic
    allowed_end = {"fixed", "last_month_end", "today"}
    allowed_start = {"fixed", "earliest", "expand_1y", "expand_5y"}
    strat_end = end_period_strategy if end_period_strategy in allowed_end else "last_month_end"
    strat_start = start_period_strategy if start_period_strategy in allowed_start else "fixed"
    q = db.query(IndexImportQuery).filter(IndexImportQuery.url == url).first()
    if q is None:
        q = IndexImportQuery(
            url=url,
            dataflow_id=dataflow_id,
            key_part=key_part,
            updated_at=now,
            last_run_at=now,
            end_period_strategy=strat_end,
            start_period_strategy=strat_start,
        )
        db.add(q)
        db.flush()
    else:
        q.updated_at = now
        q.last_run_at = now
        # preserva preferenza utente: non sovrascrivere strategie esistenti
        if not getattr(q, "end_period_strategy", None):
            q.end_period_strategy = strat_end
        if not getattr(q, "start_period_strategy", None):
            q.start_period_strategy = strat_start
    db.query(IndexImportQuerySeries).filter(IndexImportQuerySeries.query_id == q.id).delete(
        synchronize_session=False
    )
    for series_id in series_ids:
        db.add(IndexImportQuerySeries(query_id=q.id, series_id=series_id))
    db.commit()


def _get_saved_query_or_404(db: Session, query_id: str) -> IndexImportQuery:
    try:
        qid = uuid.UUID(query_id)
    except ValueError:
        raise HTTPException(404, "Query SDMX salvata non trovata")
    q = db.query(IndexImportQuery).filter(IndexImportQuery.id == qid).first()
    if q is None:
        raise HTTPException(404, "Query SDMX salvata non trovata")
    return q


def _latest_saved_queries(db: Session, series_ids: list[str]) -> dict[str, IndexImportQuery]:
    """Per ogni serie il link più recente verso una query salvata (no N+1)."""
    if not series_ids:
        return {}
    links = (
        db.query(IndexImportQuerySeries, IndexImportQuery)
        .join(IndexImportQuery, IndexImportQuerySeries.query_id == IndexImportQuery.id)
        .filter(IndexImportQuerySeries.series_id.in_(series_ids))
        .order_by(
            IndexImportQuery.created_at.desc(),
            IndexImportQuery.last_run_at.desc(),
        )
        .all()
    )
    latest: dict[str, IndexImportQuery] = {}
    for link, q in links:
        latest.setdefault(link.series_id, q)
    return latest


def _retry_after_seconds(resp) -> float | None:
    raw = resp.headers.get("Retry-After")
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _wait_rate_slot(max_wait: float = 45.0) -> None:
    try:
        wait_for_slot(max_wait=max_wait)
    except RateLimitTimeout as e:
        retry_after = max(1.0, ceil(e.wait_seconds))
        raise HTTPException(
            503,
            detail=f"Istat consente 5 query/minuto per IP. Riprova tra {int(retry_after)}s.",
            headers={"Retry-After": str(int(retry_after))},
        )


def _read_stream_limited(resp) -> bytes:
    chunks: list[bytes] = []
    total = 0
    label = f"limite {SDMX_MAX_RESPONSE_BYTES // (1024 * 1024)} MB"
    content_length = resp.headers.get("content-length")
    if (
        content_length
        and content_length.isdigit()
        and int(content_length) > SDMX_MAX_RESPONSE_BYTES
    ):  # noqa: E501
        raise HTTPException(413, f"Risposta troppo grande (limite {label})")
    for chunk in resp.iter_bytes():
        total += len(chunk)
        if total > SDMX_MAX_RESPONSE_BYTES:
            raise HTTPException(413, f"Risposta troppo grande ({label})")
        chunks.append(chunk)
    return b"".join(chunks)


_FREQ_LABELS = {"A": "annuale", "M": "mensile", "Q": "trimestrale"}


def _decode_sdmx_content(content: bytes) -> str:
    try:
        return content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return content.decode("latin-1")


def _rewrite_freq_url(url: str, freq: str, probe: bool = False) -> str | None:
    """Riscrive la posizione FREQ della chiave (primo token).

    probe=True: rimuove la finestra periodo e chiede l'ultima osservazione,
    così la risposta dipende solo dall'esistenza di dati per la frequenza."""
    parsed = urllib.parse.urlsplit(url)
    m = re.match(r"^(/SDMXWS/rest/data/[^/]+/)([^/]+)(/.*)$", parsed.path)
    if not m:
        return None
    base, key, rest = m.group(1), m.group(2), m.group(3)
    tokens = key.split(".")
    tokens[0] = freq
    params = dict(urllib.parse.parse_qsl(parsed.query, keep_blank_values=True))
    if probe:
        params.pop("startPeriod", None)
        params.pop("endPeriod", None)
        params["lastNObservations"] = "1"
    params["format"] = "csv"
    return urllib.parse.urlunsplit(
        (
            parsed.scheme,
            parsed.netloc,
            base + ".".join(tokens) + rest,
            urllib.parse.urlencode(params),
            "",
        )
    )


_PROBE_VERDICT_LABELS = {
    "ok": "dati presenti",
    "none": "nessun dato",
    "timeout": "non verificabile (timeout)",
}


def _probe_frequencies(url: str, frequencies: list[str]) -> dict[str, str]:
    """Verifica quali frequenze hanno dati nel dataflow (mini query, 1 oss.).

    Ogni probe ha budget ridotto e nessun retry: un server che appende (come
    con chiavi tutti-wildcard) non blocca la scoperta.
    Valori: "ok" = dati presenti, "none" = NoRecordsFound (404),
    "timeout" = Istat non ha risposto entro il budget (non verificabile)."""
    result: dict[str, str] = {}
    for freq in frequencies:
        if freq not in ("A", "M", "Q"):
            continue
        probe_url = _rewrite_freq_url(url, freq, probe=True)
        if not probe_url:
            continue
        try:
            content = _fetch_sdmx_csv(probe_url, attempts=1, budget=SDMX_PROBE_BUDGET)
            result[freq] = "ok" if content.strip() else "none"
        except SdmxNoRecordsError:
            result[freq] = "none"
        except HTTPException as e:
            # 429/503: problema di rate limit, da non mascherare
            if e.status_code in (429, 503):
                raise
            result[freq] = "timeout"
    return result


def _no_data_message(url: str, original_freq: str, verdicts: dict[str, str]) -> str:
    checked = " · ".join(
        f"{_FREQ_LABELS.get(f, f)}: {_PROBE_VERDICT_LABELS[verdicts[f]]}" for f in sorted(verdicts)
    )
    if not any(v == "ok" for v in verdicts.values()):
        return (
            f"Nessun dato {_FREQ_LABELS.get(original_freq, original_freq)} per il "
            f"periodo richiesto (Istat 404). Verifiche: {checked}. Suggerimento: riduci "
            "i wildcard della chiave filtrando le dimensioni (REF_AREA, DATA_TYPE, ecc.) "
            "nel databrowser: le query con codici espliciti rispondono più rapidamente."
        )
    examples = " · ".join(
        f"{_FREQ_LABELS.get(f, f)}: {_rewrite_freq_url(url, f) or '—'}"
        for f in sorted(f for f, s in verdicts.items() if s == "ok")
    )
    return (
        f"Nessun dato {_FREQ_LABELS.get(original_freq, original_freq)} per il periodo "
        f"richiesto (Istat 404). Frequenze disponibili nel dataflow: {examples}. "
        "Ripeti la query con la frequenza voluta."
    )


def _upstream_error_message(status: int) -> tuple[int, str] | None:
    """Traduce gli errori del webservice Istat in messaggi chiari per l'utente.
    Il 404 (NoRecordsFound) è gestito a monte come SdmxNoRecordsError."""
    if status == 422:
        return (
            422,
            "Istat ha rifiutato la chiave della query (HTTP 422): controlla il numero "
            "di dimensioni della chiave o riprendi l'URL dalla sezione Query SDMX del "
            "databrowser.",
        )
    if status == 400:
        return (
            400,
            "Query dati SDMX non valida (HTTP 400): riprendi l'URL dalla sezione "
            "Query SDMX del databrowser.",
        )
    return None


def _fetch_sdmx_csv(url: str, attempts: int = 2, budget: float | None = None) -> str:
    """Scarica il CSV SDMX rispettando il rate limit Istat (5 query/min/IP).

    Il budget totale limita l'intera operazione (tentativi inclusi): una query
    che appende sul server non blocca l'endpoint oltre il budget. Le probe di
    esistenza dati usano attempt=1 e un budget ridotto (SDMX_PROBE_BUDGET):
    un server che non risponde viene trattato come "nessun dato".
    """
    _wait_rate_slot()
    retry_after: float | None = None
    headers = {"Accept": "text/csv"}
    deadline = time.monotonic() + (budget if budget is not None else SDMX_FETCH_TOTAL_BUDGET)
    for attempt in range(attempts):
        if attempt > 0:
            if retry_after is not None and 0 < retry_after <= 60:
                remaining = deadline - time.monotonic()
                time.sleep(min(retry_after, max(0.0, remaining)))
            _wait_rate_slot()
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise HTTPException(
                504, "Timeout nella chiamata al webservice Istat. Riprova più tardi."
            )
        try:
            timeout = httpx.Timeout(
                min(SDMX_FETCH_TIMEOUT.read, remaining),
                connect=min(SDMX_FETCH_TIMEOUT.connect, remaining),
            )
            with httpx.Client(timeout=timeout, follow_redirects=True) as client:
                with client.stream("GET", url, headers=headers) as resp:
                    if (resp.url.host or "").lower() != SDMX_ALLOWED_HOST:
                        raise HTTPException(502, "Redirect verso un dominio non consentito")
                    if resp.status_code == 429:
                        retry_after = _retry_after_seconds(resp)
                        continue
                    resp.raise_for_status()
                    return _decode_sdmx_content(_read_stream_limited(resp))
        except httpx.HTTPStatusError as e:
            if e.response.status_code in (403, 429):
                raise HTTPException(
                    429,
                    "Istat ha rifiutato la richiesta (rate limit): possibile blocco "
                    "temporaneo dell'IP (1-2 giorni). Riprova più tardi.",
                )
            if e.response.status_code == 404:
                raise SdmxNoRecordsError()
            mapped = _upstream_error_message(e.response.status_code)
            if mapped:
                raise HTTPException(mapped[0], mapped[1])
            raise HTTPException(502, f"Errore dal webservice Istat (HTTP {e.response.status_code})")
        except httpx.TimeoutException:
            if attempt < attempts - 1:
                continue
            raise HTTPException(
                504, "Timeout nella chiamata al webservice Istat. Riprova più tardi."
            )
    if retry_after is not None:
        if retry_after > 60:
            msg = (
                "Istat ha risposto 429 (rate limit): possibile blocco temporaneo "
                "dell'IP (1-2 giorni). Riprova più tardi."
            )
        else:
            msg = "Istat ha ripetutamente risposto 429 (rate limit). Riprova più tardi."
        raise HTTPException(429, msg)
    raise HTTPException(502, "Errore dal webservice Istat")


@router.post("/import-csv", status_code=200)
def import_csv(
    file: UploadFile = File(...),
    group_key: str = "",
    freq_param: str = "",
    db: Session = Depends(get_db),
):
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(400, "Sono ammessi solo file CSV")

    from app.core.uploads import read_upload_limited

    details = import_sdmx_content(
        _decode_sdmx_content(read_upload_limited(file)),
        db,
        group_key=group_key,
        freq_param=freq_param,
    )
    return {"message": "Importazione completata", "details": details}


def _build_example_url_for_unfiltered(
    url: str, key_part: str, unfiltered: dict[str, list[str]]
) -> str | None:
    """Costruisce URL d'esempio filtrato sostituendo wildcard '.' con valori suggeriti.

    Strategia: sostituisce ogni token vuoto '.' nella chiave con il primo valore
    ordinato della corrispondente dimensione (in ordine alfabetico). Se un
    valore contiene 'N' (caso DATA_TYPE), preferisce 'N'. Non auto-filtra
    silenziosamente: serve solo come suggerimento nel messaggio d'errore.
    """
    try:
        parsed = urllib.parse.urlsplit(url)
        m = re.match(r"^(/SDMXWS/rest/data/[^/]+/)([^/]+)(/.*)$", parsed.path)
        if not m:
            return None
        base, key, rest = m.group(1), m.group(2), m.group(3)
        tokens = key.split(".")
        dims_sorted = sorted(unfiltered.keys())
        # Prepara valori suggeriti: preferisci N se presente
        suggested: list[str] = []
        for dim in dims_sorted:
            vals = unfiltered.get(dim) or []
            if not vals:
                continue
            chosen = "N" if "N" in vals else sorted(vals)[0]
            suggested.append(chosen)
        if not suggested:
            return None
        idx = 0
        replaced = False
        for i, tok in enumerate(tokens):
            if tok == "" and idx < len(suggested):
                tokens[i] = suggested[idx]
                idx += 1
                replaced = True
        # Se nessuna sostituzione ma ci sono wildcard e una sola dimensione,
        # riempi comunque il primo vuoto (fallback)
        if not replaced and "" in tokens and suggested:
            for i, tok in enumerate(tokens):
                if tok == "":
                    tokens[i] = suggested[0]
                    replaced = True
                    break
        if not replaced:
            return None
        new_key = ".".join(tokens)
        return urllib.parse.urlunsplit(
            (parsed.scheme, parsed.netloc, base + new_key + rest, parsed.query, "")
        )
    except Exception:
        return None


def _maybe_enrich_unfiltered_error(e: HTTPException, url: str, key_part: str) -> HTTPException:
    """Se l'errore è 422 con unfiltered_dimensions, arricchisce con example_url e logga."""
    if (
        e.status_code != 422
        or not isinstance(e.detail, dict)
        or "unfiltered_dimensions" not in e.detail
    ):
        return e
    try:
        details = e.detail.get("unfiltered_dimensions") or {}
        logger = logging.getLogger("indices")
        logger.warning(
            "SDMX unfiltered dimensions %s for url %s details=%s",
            list(details.keys()),
            url,
            details,
        )
        enriched = dict(e.detail)
        ex = _build_example_url_for_unfiltered(url, key_part, details)
        if ex:
            enriched["example_url"] = ex
        return HTTPException(status_code=422, detail=enriched)
    except Exception:
        return e


def _execute_sdmx_import(
    url: str,
    dataflow_id: str,
    key_part: str,
    db,
    end_period_strategy: str | None = None,
    start_period_strategy: str | None = None,
) -> dict:
    """Scarica, parsa e importa i dati SDMX. Chiamata dentro il job (thread)."""
    original_freqs = [c for c in key_part.split(".")[0].split("+") if c]
    # per preservare strategia su frequency-adjusted, cerca query esistente (se any)
    existing_q = db.query(IndexImportQuery).filter(IndexImportQuery.url == url).first()
    if existing_q is None:
        existing_q = (
            db.query(IndexImportQuery)
            .filter(
                IndexImportQuery.dataflow_id == dataflow_id, IndexImportQuery.key_part == key_part
            )
            .order_by(IndexImportQuery.updated_at.desc())
            .first()
        )
    # priorità: param esplicito > esistente > default
    existing_end_strategy = end_period_strategy or (
        getattr(existing_q, "end_period_strategy", None) if existing_q else None
    )
    existing_start_strategy = start_period_strategy or (
        getattr(existing_q, "start_period_strategy", None) if existing_q else None
    )
    try:
        content = _fetch_sdmx_csv(url)
    except SdmxNoRecordsError:
        if len(original_freqs) > 1:
            verdicts = _probe_frequencies(url, original_freqs)
        else:
            verdicts = {original_freqs[0]: "none"}
            verdicts.update(
                _probe_frequencies(url, [f for f in ("A", "M", "Q") if f != original_freqs[0]])
            )
        available = {f for f, v in verdicts.items() if v == "ok"}
        if len(available) == 1:
            (freq,) = available
            fixed_url = _rewrite_freq_url(url, freq) or url
            try:
                content = _fetch_sdmx_csv(fixed_url)
            except SdmxNoRecordsError:
                raise HTTPException(422, _no_data_message(url, "+".join(original_freqs), verdicts))
            try:
                details = import_sdmx_content(content, db)
            except HTTPException as e:
                raise _maybe_enrich_unfiltered_error(e, fixed_url, key_part)
            details["frequency_adjusted"] = f"{'+'.join(original_freqs)}→{freq}"
            if details.get("series_ids"):
                _save_import_query(
                    db,
                    fixed_url,
                    dataflow_id,
                    key_part,
                    details["series_ids"],
                    end_period_strategy=existing_end_strategy,
                    start_period_strategy=existing_start_strategy,
                )
            return {
                "message": "Importazione completata",
                "dataflow_id": dataflow_id,
                "url": fixed_url,
                "details": details,
            }
        raise HTTPException(422, _no_data_message(url, "+".join(original_freqs), verdicts))

    try:
        details = import_sdmx_content(content, db)
    except HTTPException as e:
        raise _maybe_enrich_unfiltered_error(e, url, key_part)
    if details.get("series_ids"):
        _save_import_query(
            db,
            url,
            dataflow_id,
            key_part,
            details["series_ids"],
            end_period_strategy=existing_end_strategy,
            start_period_strategy=existing_start_strategy,
        )
    return {
        "message": "Importazione completata",
        "dataflow_id": dataflow_id,
        "url": url,
        "details": details,
    }


def _run_sdmx_import_job(
    url: str,
    dataflow_id: str,
    key_part: str,
    end_period_strategy: str | None = None,
    start_period_strategy: str | None = None,
) -> dict:
    """Runner del job: sessione DB propria (il thread non ha quella della
    richiesta) e errori HTTP trasformati in messaggio per l'utente."""
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        return _execute_sdmx_import(
            url,
            dataflow_id,
            key_part,
            db,
            end_period_strategy=end_period_strategy,
            start_period_strategy=start_period_strategy,
        )
    except HTTPException as e:
        if isinstance(e.detail, dict):
            raise RuntimeError(json.dumps(e.detail, ensure_ascii=False))
        raise RuntimeError(e.detail)
    except Exception:
        logging.getLogger("indices").exception("Import SDMX fallito")
        raise
    finally:
        db.close()


@router.post("/import-sdmx", status_code=202)
def import_sdmx(payload: SdmxImportRequest):
    """Avvia l'import in background (Istat può impiegare 5-10 minuti) e
    ritorna subito il job_id: la UI fa polling su GET /import-jobs/{id}."""
    allowed_end = {"fixed", "last_month_end", "today"}
    allowed_start = {"fixed", "earliest", "expand_1y", "expand_5y"}
    strategy_end = (
        payload.end_period_strategy
        if payload.end_period_strategy in allowed_end
        else "last_month_end"
    )
    strategy_start = (
        payload.start_period_strategy if payload.start_period_strategy in allowed_start else "fixed"
    )
    url, dataflow_id, key_part = _validate_sdmx_url(payload.url)
    # se chiamata con strategia esplicita, passala al job via closure; _execute gestirà creazione
    job = sdmx_import_jobs.submit(
        url=url,
        runner=lambda s_end=strategy_end, s_start=strategy_start: _run_sdmx_import_job(
            url, dataflow_id, key_part, end_period_strategy=s_end, start_period_strategy=s_start
        ),
    )
    return {"job_id": job["id"], "status": job["status"], "url": url}


@router.get("/import-jobs/{job_id}")
def import_job_status(job_id: str):
    job = sdmx_import_jobs.get(job_id)
    if job is None:
        raise HTTPException(
            404,
            "Import non trovato: il backend è stato forse riavviato mentre "
            "l'import era in corso. Riprova.",
        )
    return job


class SavedQueryUpdate(BaseModel):
    url: str
    end_period_strategy: str | None = None
    start_period_strategy: str | None = None

    @field_validator("end_period_strategy")
    @classmethod
    def validate_strategy(cls, v):
        if v is None:
            return v
        allowed = {"fixed", "last_month_end", "today"}
        if v not in allowed:
            raise ValueError(f"strategia non valida: {v}")
        return v

    @field_validator("start_period_strategy")
    @classmethod
    def validate_start_strategy(cls, v):
        if v is None:
            return v
        allowed = {"fixed", "earliest", "expand_1y", "expand_5y"}
        if v not in allowed:
            raise ValueError(f"strategia start non valida: {v}")
        return v


@router.get("/saved-queries")
def list_saved_queries(q: str | None = None, db: Session = Depends(get_db)):
    query = db.query(IndexImportQuery).order_by(IndexImportQuery.updated_at.desc())
    if q:
        like = f"%{q}%"
        query = query.filter(
            or_(IndexImportQuery.dataflow_id.ilike(like), IndexImportQuery.url.ilike(like))
        )
    rows = query.all()
    # aggregate counts
    counts = dict(
        db.query(IndexImportQuerySeries.query_id, func.count(IndexImportQuerySeries.series_id))
        .group_by(IndexImportQuerySeries.query_id)
        .all()
    )
    return [_saved_query_payload(r, counts.get(r.id, 0)) for r in rows]


@router.get("/saved-queries/{query_id}")
def get_saved_query(query_id: str, db: Session = Depends(get_db)):
    """Ritorna il dettaglio di una query SDMX salvata."""
    q = _get_saved_query_or_404(db, query_id)
    series_count = (
        db.query(IndexImportQuerySeries).filter(IndexImportQuerySeries.query_id == q.id).count()
    )
    return _saved_query_payload(q, series_count)


@router.post("/saved-queries/{query_id}/run", status_code=202)
def run_saved_query(query_id: str, db: Session = Depends(get_db)):
    """Riesegue una query salvata: ri-valida l'URL (protegge da dati corrotti
    in DB) e riusa il job store in-memory. Applica auto-date se strategia != fixed."""
    q = _get_saved_query_or_404(db, query_id)
    url, dataflow_id, key_part = _validate_sdmx_url(q.url)
    end_strategy = getattr(q, "end_period_strategy", "last_month_end") or "last_month_end"
    start_strategy = getattr(q, "start_period_strategy", "fixed") or "fixed"
    try:
        resolved_url, meta = resolve_sdmx_url_dates_both(url, end_strategy, start_strategy)
    except Exception:
        resolved_url, meta = url, {}
        logging.getLogger("indices").warning(
            "resolve_sdmx_url_dates fallita, uso url originale", exc_info=True
        )
    if end_strategy != "fixed" and meta.get("endPeriod"):
        logging.getLogger("indices").info(
            "SDMX auto-date %s -> %s strategy=%s",
            meta.get("original_endPeriod"),
            meta.get("endPeriod"),
            end_strategy,
        )
    if start_strategy != "fixed" and meta.get("startPeriod"):
        logging.getLogger("indices").info(
            "SDMX auto-date start %s -> %s strategy=%s",
            meta.get("original_startPeriod"),
            meta.get("startPeriod"),
            start_strategy,
        )
    # usa resolved_url per fetch; dataflow_id/key_part restano quelli validati
    job = sdmx_import_jobs.submit(
        url=resolved_url,
        runner=lambda: _run_sdmx_import_job(
            resolved_url,
            dataflow_id,
            key_part,
            end_period_strategy=end_strategy,
            start_period_strategy=start_strategy,
        ),
    )
    return {
        "job_id": job["id"],
        "status": job["status"],
        "url": resolved_url,
        "original_url": url,
        "resolved_meta": meta,
    }


@router.put("/saved-queries/{query_id}")
def update_saved_query(query_id: str, payload: SavedQueryUpdate, db: Session = Depends(get_db)):
    q = _get_saved_query_or_404(db, query_id)
    url, dataflow_id, key_part = _validate_sdmx_url(payload.url)
    q.url = url
    q.dataflow_id = dataflow_id
    q.key_part = key_part
    if payload.end_period_strategy is not None:
        q.end_period_strategy = payload.end_period_strategy
    if payload.start_period_strategy is not None:
        q.start_period_strategy = payload.start_period_strategy
    q.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(q)
    series_count = (
        db.query(IndexImportQuerySeries).filter(IndexImportQuerySeries.query_id == q.id).count()
    )
    return _saved_query_payload(q, series_count)


@router.delete("/saved-queries/{query_id}", status_code=200)
def delete_saved_query(query_id: str, db: Session = Depends(get_db)):
    q = _get_saved_query_or_404(db, query_id)
    db.query(IndexImportQuerySeries).filter(IndexImportQuerySeries.query_id == q.id).delete(
        synchronize_session=False
    )
    db.delete(q)
    log_event(
        db,
        "indices.delete_import_query",
        payload={"query_id": str(q.id), "url": q.url, "dataflow_id": q.dataflow_id},
        motivation="Eliminazione query SDMX da interfaccia Indici ISTAT",
    )
    db.commit()
    return {"deleted": True, "query_id": str(q.id)}


@router.get("/groups")
def list_groups(db: Session = Depends(get_db)):
    rows = db.query(IndexSeries.classification_ref).distinct().all()
    groups = []
    for (ref,) in rows:
        if not ref:
            continue
        count = db.query(IndexSeries).filter(IndexSeries.classification_ref == ref).count()
        obs_count = (
            db.query(IndexObservation)
            .join(IndexSeries, IndexObservation.series_id == IndexSeries.id)
            .filter(IndexSeries.classification_ref == ref)
            .count()
        )
        groups.append({"key": ref, "series_count": count, "observation_count": obs_count})
    return groups


@router.get("/by-group/{classification_ref}")
def get_by_group(classification_ref: str, db: Session = Depends(get_db)):
    series_list = (
        db.query(IndexSeries)
        .filter(IndexSeries.classification_ref == classification_ref)
        .order_by(IndexSeries.id)
        .all()
    )
    saved_by_series = _latest_saved_queries(db, [s.id for s in series_list])
    ateco_labels = _ateco_labels_for_wages(db, series_list)
    result = []
    for s in series_list:
        obs = (
            db.query(IndexObservation)
            .filter(IndexObservation.series_id == s.id)
            .order_by(IndexObservation.ref_period)
            .all()
        )
        result.append(
            {
                "id": s.id,
                "name": s.name,
                "frequency": s.frequency,
                "normative_category": s.normative_category,
                "classification_ref": s.classification_ref,
                "observation_count": len(obs),
                "saved_query": _saved_query_payload(saved_by_series.get(s.id)),
                "ateco_label": ateco_labels.get(s.id),
                "observations": [
                    {
                        "period": o.ref_period.isoformat(),
                        "value": o.value,
                        "is_definitive": o.is_definitive,
                    }
                    for o in obs
                ],
            }
        )
    return result


@router.post("/backfill-queries")
@router.post("/backfill-sdmx-queries")
def backfill_sdmx_queries(
    dry_run: bool = False,
    classification_ref: str | None = None,
    db: Session = Depends(get_db),
):
    """Popola IndexImportQuery per serie esistenti senza query salvata.

    Solo scrittura query (nessun fetch SDMX, nessun rate-limit). Idempotente:
    serie già con query vengono saltate. Ritorna total/backfilled/skipped.
    """
    # valida classification_ref se fornito
    if classification_ref is not None:
        try:
            configs = _load_dataflow_configs()
            allowed = {c.get("group_key") for c in configs if c.get("group_key")}
            # aggiungi anche chiavi note del frontend (ppi, ps_business, etc.)
            allowed.update(sdmx_backfill.CLASSIFICATION_TO_EXPLORER.keys())
            # includi anche i dataflow id come fallback? no, solo group_key
            if classification_ref not in allowed:
                # consenti anche filtri su gruppi realmente esistenti in DB (ATECO_G custom)
                exists = (
                    db.query(IndexSeries)
                    .filter(IndexSeries.classification_ref == classification_ref)
                    .first()
                )
                if not exists:
                    msg = (
                        f"classification_ref sconosciuto: {classification_ref}. "
                        f"Ammessi: {sorted(allowed)}"
                    )
                    raise HTTPException(422, msg)
        except HTTPException:
            raise
        except Exception:
            # se yaml non leggibile, non bloccare validazione — procedi
            pass

    q = db.query(IndexSeries)
    if classification_ref:
        q = q.filter(IndexSeries.classification_ref == classification_ref)
    series_list = q.order_by(IndexSeries.id).all()
    total = len(series_list)
    if total == 0:
        return {"total": 0, "backfilled": 0, "skipped": [], "dry_run": dry_run}

    latest = _latest_saved_queries(db, [s.id for s in series_list])
    to_backfill = [s for s in series_list if s.id not in latest]

    backfilled = 0
    skipped: list[dict] = []
    # Raggruppa per URL normalizzato per evitare sovrascrittura _save_import_query
    # (serie PPI con stesso base code ma suffisso mercato diverso condividono URL)
    groups: dict[str, dict] = {}  # normalized_url -> {dataflow_id, key_part, series_ids, raw_url}
    for s in to_backfill:
        raw = sdmx_backfill.build_sdmx_url(s)
        if not raw:
            skipped.append({"id": s.id, "reason": "non_mappabile"})
            continue
        normalized = None
        dataflow_id = None
        key_part = None
        last_exc = None
        candidates = [raw]
        if sdmx_backfill._explorer_for_series(s) == "PPI":
            code = sdmx_backfill._code_from_series(s)
            if code:
                ext = sdmx_backfill._build_ppi_extended_url(s, code)
                if ext and ext not in candidates:
                    candidates.append(ext)
        for cand in candidates:
            try:
                normalized, dataflow_id, key_part = _validate_sdmx_url(cand)
                break
            except HTTPException as e:
                last_exc = e
                continue
        if not normalized:
            skipped.append(
                {"id": s.id, "reason": f"invalid_url: {last_exc.detail if last_exc else 'unknown'}"}
            )
            continue
        if dry_run:
            # in dry_run non serve raggruppare, conta come backfilled
            backfilled += 1
            # per tracciare gruppi anche in dry_run (facoltativo)
            g = groups.get(normalized)
            if not g:
                groups[normalized] = {
                    "dataflow_id": dataflow_id,
                    "key_part": key_part,
                    "series_ids": [s.id],
                    "raw_url": normalized,
                }
            else:
                g["series_ids"].append(s.id)
            continue
        # reale: accumula gruppo
        g = groups.get(normalized)
        if not g:
            groups[normalized] = {
                "dataflow_id": dataflow_id,
                "key_part": key_part,
                "series_ids": [s.id],
                "raw_url": normalized,
            }
        else:
            g["series_ids"].append(s.id)

    if not dry_run:
        from app.models.index_import_query import IndexImportQuery, IndexImportQuerySeries

        for norm_url, grp in groups.items():
            try:
                # merge con eventuali link già esistenti per questo URL (evita sovrascrittura)
                existing = (
                    db.query(IndexImportQuery).filter(IndexImportQuery.url == norm_url).first()
                )
                if existing:
                    existing_ids = {
                        row.series_id
                        for row in db.query(IndexImportQuerySeries)
                        .filter(IndexImportQuerySeries.query_id == existing.id)
                        .all()
                    }
                    combined = list(existing_ids.union(set(grp["series_ids"])))
                    _save_import_query(db, norm_url, grp["dataflow_id"], grp["key_part"], combined)
                else:
                    _save_import_query(
                        db, norm_url, grp["dataflow_id"], grp["key_part"], grp["series_ids"]
                    )
                backfilled += len(grp["series_ids"])
            except Exception as e:
                for sid in grp["series_ids"]:
                    skipped.append({"id": sid, "reason": str(e)[:200]})
        # backfilled già contato per gruppi; se dry_run era true, backfilled già contato sopra
    elif dry_run:
        # backfilled già contato nel loop
        pass

    if not dry_run and backfilled > 0:
        log_event(
            db,
            "indices.backfill_queries",
            payload={
                "classification_ref": classification_ref,
                "total": total,
                "backfilled": backfilled,
                "skipped": len(skipped),
            },
            motivation="Backfill query SDMX per serie esistenti",
        )

    return {"total": total, "backfilled": backfilled, "skipped": skipped, "dry_run": dry_run}


@router.delete("/{series_id}/observations", status_code=200)
def clear_series_observations(series_id: str, db: Session = Depends(get_db)):
    """Svuota un indice: elimina tutte le osservazioni, conservando la serie."""
    series = db.query(IndexSeries).filter(IndexSeries.id == series_id).first()
    if not series:
        raise HTTPException(404, "Serie non trovata")
    deleted = (
        db.query(IndexObservation)
        .filter(IndexObservation.series_id == series_id)
        .delete(synchronize_session=False)
    )
    log_event(
        db,
        "indices.clear_series",
        payload={"series_id": series_id, "deleted": deleted},
        motivation="Svuotamento indice da interfaccia Indici ISTAT",
    )
    db.commit()
    return {"series_id": series_id, "deleted": deleted}
