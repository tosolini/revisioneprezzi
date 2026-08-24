"""Importazione osservazioni ISTAT da contenuto CSV in formato SDMX.

Parser unico condiviso da:
- POST /api/v1/indices/import-csv  (upload file)
- POST /api/v1/indices/import-sdmx (fetch da query SDMX)

Rileva automaticamente il dataflow dalla colonna DATAFLOW del CSV e usa
seeds/istat_data_config.yaml per gruppo, frequenza e nomi delle serie.
Per dataflow non in configurazione ricade sui parametri forniti e rileva la
dimensione "serie" dalla colonna con piu' valori distinti.
"""

import csv
import io
from datetime import date, datetime
from pathlib import Path

import yaml
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.index_observation import IndexObservation
from app.models.index_series import IndexSeries

CONFIG_PATH = (
    Path(__file__).resolve().parents[2] / "seeds" / "istat_data_config.yaml"
)

_DATAFLOW_CONFIG_CACHE = None

# Commit ogni N righe: preserva il comportamento per-riga (via savepoint)
# evitando il costo di una transazione per osservazione.
COMMIT_EVERY = 200

_NON_DIMENSION_COLUMNS = {
    "DATAFLOW", "FREQ", "Frequenza", "TIME_PERIOD", "TIME", "Period",
    "OBS_VALUE", "obs_value", "Value", "Osservazione", "OBS_STATUS",
    "OBS_CONF", "MEASURE", "BASE_PER", "UNIT_MEAS", "UNIT_MULT", "Flags",
    "CONF_STATUS",
}


def _load_dataflow_configs() -> list[dict]:
    global _DATAFLOW_CONFIG_CACHE
    if _DATAFLOW_CONFIG_CACHE is None:
        with open(CONFIG_PATH) as f:
            _DATAFLOW_CONFIG_CACHE = yaml.safe_load(f).get("dataflows", [])
    return _DATAFLOW_CONFIG_CACHE


def _find_dataflow_config(dataflow_id: str) -> dict | None:
    for df in _load_dataflow_configs():
        if df["dataflow_id"] == dataflow_id:
            return df
    return None


def _parse_dataflow_id(raw: str) -> str | None:
    raw = raw.split(":")[-1].split("(")[0].strip()
    return raw if "_" in raw else None


def _parse_period(period_str: str, freq: str) -> date:
    period_str = period_str.strip()
    if freq == "annual" or (
        freq == "quarterly" and period_str[:4].isdigit() and len(period_str) == 4
    ):
        return date.fromisoformat(f"{period_str[:4]}-01-01")
    if freq == "quarterly":
        year, q = period_str.split("-")
        month = {"Q1": "01", "Q2": "04", "Q3": "07", "Q4": "10"}.get(q, "01")
        return date.fromisoformat(f"{year}-{month}-01")
    if freq == "monthly":
        if len(period_str) == 7 and period_str[4] == "-":
            return date.fromisoformat(f"{period_str}-01")
        return date.fromisoformat(period_str[:10])
    return datetime.strptime(period_str[:10], "%Y-%m-%d").date()


def _normalize_columns(reader: csv.DictReader) -> dict:
    """Mappa nomi colonne SDMX (ITA o ENG) a nomi normalizzati.
    Ritorna un dict normalized_name -> original_fieldname."""
    raw = reader.fieldnames or []
    inv = {}
    for c in raw:
        cc = c.strip().replace("\ufeff", "")
        if cc in ("Osservazione", "OBS_VALUE", "obs_value", "Value"):
            inv["value"] = c
        elif cc in (
            "ECON_ACTIVITY_NACE_2007",
            "HOM_TYPE_WORK",
            "GROUP_CATEGORY_COST",
            "E_COICOP_REV_ISTAT",
            "MAIN_AGREEMENT_GROUP",
        ):
            inv["series_code"] = c
        elif cc in ("TIME_PERIOD", "TIME", "Period"):
            inv["period"] = c
        elif cc in ("FREQ", "Frequenza"):
            inv["freq"] = c
        elif cc in ("OBS_STATUS",):
            inv["status"] = c
        elif cc in ("MARKET", "Mercato di riferimento"):
            inv["market"] = c
        elif cc in ("DATAFLOW",):
            inv["dataflow"] = c
    return inv


def _dimension_candidates(fieldnames, mapping: dict,
                         series_code_cols: list[str]) -> list[str]:
    excluded = set(_NON_DIMENSION_COLUMNS) | set(series_code_cols) | {
        mapping.get("value"), mapping.get("period"), mapping.get("freq"),
        mapping.get("status"), mapping.get("market"), mapping.get("dataflow"),
    }
    excluded = {v for v in excluded if v}
    return [
        c for c in (fieldnames or [])
        if c and c.strip() not in excluded
        and not c.lstrip().startswith(("NOTE_", "UNIT_", "Flags"))
    ]


def _distinct_counts(reader: csv.DictReader, candidates: list[str]) -> dict[str, set]:
    distinct: dict[str, set] = {c: set() for c in candidates}
    for row in reader:
        for c in candidates:
            v = (row.get(c) or "").strip()
            if v:
                distinct[c].add(v)
    return distinct


def _detect_series_code_cols(reader: csv.DictReader, mapping: dict) -> list[str]:
    """Sceglie la/e colonna/e dimensione che identificano la serie in un
    dataflow sconosciuto: la colonna con piu' valori distinti (la dimensione
    di classificazione varia, i metadati come REF_AREA sono costanti).
    In caso di parita' (es. query filtrata su una sola serie) usa l'ultima."""
    candidates = _dimension_candidates(reader.fieldnames, mapping, [])
    if not candidates:
        return []
    distinct = _distinct_counts(reader, candidates)
    max_count = max((len(s) for s in distinct.values()), default=0)
    best = [c for c in candidates if len(distinct[c]) == max_count]
    # parita': valori tutti costanti -> ultima dimensione del DSD
    return best[-1:] if len(best) > 1 else best


def _reject_unfiltered_dimensions(reader: csv.DictReader, mapping: dict,
                                  series_code_cols: list[str]) -> None:
    """Rifiuta query che lasciano dimensioni non filtrate in un dataflow
    configurato: piu' valori della stessa dimensione verrebbero mescolati
    nella stessa serie (es. PROF_STATUS_EMP, DATA_TYPE nelle retribuzioni)."""
    candidates = _dimension_candidates(reader.fieldnames, mapping, series_code_cols)
    if not candidates:
        return
    distinct = _distinct_counts(reader, candidates)
    unfiltered = sorted(c for c in candidates if len(distinct[c]) > 1)
    if unfiltered:
        raise HTTPException(
            422,
            "La query lascia dimensioni non filtrate ("
            + ", ".join(unfiltered)
            + "): si mescolerebbero più valori nella stessa serie. "
            "Filtra queste dimensioni nel databrowser (una sola frequenza/codice) "
            "e riprova.",
        )


def _reject_mixed_frequencies(reader: csv.DictReader, mapping: dict) -> None:
    """Rifiuta CSV che mescolano frequenze (es. query A+M con dati sia annuali
    sia mensili): periodi annuali (YYYY) e mensili (YYYY-01) collidono sullo
    stesso (serie, periodo). La colonna FREQ arriva dal databrowser, quindi
    qui si guarda ai dati effettivi, non alla chiave dell'URL."""
    freq_col = mapping.get("freq")
    if not freq_col:
        return
    seen: set[str] = set()
    for row in reader:
        v = (row.get(freq_col) or "").strip().lower()
        if v in ("a", "y", "annuale"):
            seen.add("annual")
        elif v in ("m", "mensile"):
            seen.add("monthly")
        elif v in ("q", "trimestrale"):
            seen.add("quarterly")
        if len(seen) > 1:
            raise HTTPException(
                422,
                "Il file mescola più frequenze (annuale/mensile/trimestrale): i "
                "periodi collidono sulla stessa serie. Ripeti la query nel "
                "databrowser selezionando una sola frequenza.",
            )


def _row_code(row, series_code_cols: list[str]) -> str:
    parts = []
    for col in series_code_cols:
        v = (row.get(col) or "").strip()
        if v:
            parts.append(v)
    return "_".join(parts)


def _row_freq(row, mapping: dict, fallback: str) -> str:
    freq_col = mapping.get("freq")
    row_freq = (row.get(freq_col) or "").strip().lower() if freq_col else ""
    if row_freq in ("a", "y", "annuale"):
        return "annual"
    if row_freq in ("m", "mensile"):
        return "monthly"
    if row_freq in ("q", "trimestrale"):
        return "quarterly"
    return fallback


def _series_name(row, fieldnames, code: str, series_names: dict,
                 group_key: str) -> str:
    name = series_names.get(code, f"{group_key} - {code}")
    desc_cols = [
        c for c in (fieldnames or []) if "Attività" in c or "economica" in c
    ]
    if desc_cols:
        desc_val = (row.get(desc_cols[0]) or "").strip()
        if desc_val:
            name = f"{group_key} - {desc_val}"
    return name


def import_sdmx_content(
    content: str, db: Session, group_key: str = "", freq_param: str = ""
) -> dict:
    """Importa contenuto CSV in formato SDMX (scaricato da ISTAT).

    Upsert delle osservazioni su (series_id, ref_period), creando le serie
    mancanti. Ritorna il dettaglio con i contatori e il dataflow rilevato.
    """
    db.autoflush = False
    reader = csv.DictReader(io.StringIO(content), quotechar="'")
    mapping = _normalize_columns(reader)

    if not mapping.get("value") or not mapping.get("period"):
        raise HTTPException(
            400,
            "Formato CSV non riconosciuto. Colonne attese: ECON_ACTIVITY_NACE_2007 "
            "(o codici serie), TIME_PERIOD, Osservazione/OBS_VALUE",
        )

    # ── Auto-rilevamento dataflow dalla colonna DATAFLOW del CSV ──────────
    df_config = None
    detected_dataflow = None
    if mapping.get("dataflow"):
        for row in reader:
            df_val = (row.get(mapping["dataflow"]) or "").strip()
            if df_val:
                detected_dataflow = _parse_dataflow_id(df_val)
                if detected_dataflow:
                    df_config = _find_dataflow_config(detected_dataflow)
                break
        reader = csv.DictReader(io.StringIO(content), quotechar="'")
        mapping = _normalize_columns(reader)

    if df_config:
        group_key = df_config.get("group_key", group_key or "istat")
        freq_param = df_config.get("frequency", freq_param or "monthly")
        series_names = {s["code"]: s["name"] for s in df_config.get("series", [])}
        contract_type = df_config.get("contract_type")
        series_code_cols = [df_config["dimension_map"]["series_code"]]
        # Query con dimensioni extra non filtrate mescolerebbero popolazioni
        # diverse nella stessa serie: rifiutale con un messaggio chiaro.
        # (la scan consuma il reader: si riparte dalla prima riga dopo)
        _reject_unfiltered_dimensions(reader, mapping, series_code_cols)
        reader = csv.DictReader(io.StringIO(content), quotechar="'")
        mapping = _normalize_columns(reader)
    else:
        series_names = {}
        contract_type = None
        group_key = group_key or "ps_business"
        freq_param = freq_param or "quarterly"
        if mapping.get("series_code"):
            series_code_cols = [mapping["series_code"]]
        else:
            series_code_cols = _detect_series_code_cols(reader, mapping) or []
            # la detection consuma il reader: riparti dalla prima riga
            reader = csv.DictReader(io.StringIO(content), quotechar="'")
            mapping = _normalize_columns(reader)
        if not series_code_cols:
            raise HTTPException(
                400,
                "Formato CSV non riconosciuto: nessuna colonna dimensione per il "
                "codice serie",
            )

    # Frequenze mescolate = periodi collidenti: rifiuta prima di scrivere.
    _reject_mixed_frequencies(reader, mapping)
    reader = csv.DictReader(io.StringIO(content), quotechar="'")
    mapping = _normalize_columns(reader)

    freq = freq_param
    group_upper = group_key.upper()
    results = {
        "added": 0, "updated": 0, "skipped": 0, "errors": 0,
        "series_created": 0, "imported_rows": 0,
        "dataflow_id": detected_dataflow,
        "dataflow_matched": df_config is not None,
        "group_key": group_key,
        "frequency": freq_param,
    }

    row_no = 0
    for row in reader:
        row_no += 1
        try:
            code = _row_code(row, series_code_cols)
            period_str = (row.get(mapping["period"]) or "").strip()
            val_str = (row.get(mapping["value"]) or "").strip()
            status_raw = (row.get(mapping.get("status") or "") or "").strip()

            if not code or not period_str or not val_str:
                results["skipped"] += 1
                continue

            row_freq = _row_freq(row, mapping, freq)
            market_suffix = ""
            market_col = mapping.get("market")
            if market_col:
                mkt_val = (row.get(market_col) or "").strip()
                if mkt_val:
                    market_suffix = f"_{mkt_val}"

            series_id = f"ISTAT_{group_upper}_{code}{market_suffix}"
            ref_period = _parse_period(period_str, row_freq)

            try:
                value = float(val_str.replace(",", "."))
            except ValueError:
                results["skipped"] += 1
                continue

            # OBS_STATUS: P=provvisorio, E=stimato, M=manuale, T=provv. tendenza
            is_def = status_raw not in ("P", "E", "M", "T")
            name = _series_name(row, reader.fieldnames, code, series_names, group_key)

            with db.begin_nested():
                series = (
                    db.query(IndexSeries).filter(IndexSeries.id == series_id).first()
                )
                created = series is None
                if series is None:
                    db.add(IndexSeries(
                        id=series_id,
                        name=name,
                        source="ISTAT",
                        normative_category=contract_type or "services",
                        classification_ref=group_key,
                        frequency=row_freq,
                    ))
                    db.flush()
                existing = (
                    db.query(IndexObservation)
                    .filter(
                        IndexObservation.series_id == series_id,
                        IndexObservation.ref_period == ref_period,
                    )
                    .first()
                )
                if existing:
                    existing.value = value
                    existing.is_definitive = is_def
                    kind = "updated"
                else:
                    db.add(IndexObservation(
                        series_id=series_id,
                        ref_period=ref_period,
                        value=value,
                        is_definitive=is_def,
                    ))
                    kind = "added"
                db.flush()
                if created:
                    results["series_created"] += 1
                results[kind] += 1
                results["imported_rows"] += 1
        except Exception as e:
            results["errors"] += 1
            if results["errors"] <= 5:
                period_for_log = ""
                if "period_str" in locals():
                    period_for_log = period_str
                print(f"  ERR: row code={_row_code(row, series_code_cols)} "
                      f"period={period_for_log}: {e}")
        finally:
            if row_no % COMMIT_EVERY == 0:
                db.commit()

    db.commit()
    return results
