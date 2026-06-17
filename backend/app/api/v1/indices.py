import csv
import io
from datetime import date, datetime
from pathlib import Path

import yaml
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.index_observation import IndexObservation
from app.models.index_series import IndexSeries

CONFIG_PATH = Path(__file__).resolve().parent.parent.parent.parent / "seeds" / "istat_data_config.yaml"

_DATAFLOW_CONFIG_CACHE = None


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

router = APIRouter(prefix="/indices", tags=["indices"])


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


def _parse_period(period_str: str, freq: str) -> date:
    period_str = period_str.strip()
    if freq == "annual" or (freq == "quarterly" and period_str[:4].isdigit() and len(period_str) == 4):
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


def _normalize_columns(reader: csv.DictReader):
    """Mappa nomi colonne SDMX (ITA o ENG) a nomi normalizzati.
    Ritorna un dict normalized_name -> original_fieldname."""
    raw = reader.fieldnames or []
    inv = {}
    for c in raw:
        cc = c.strip().replace("\ufeff", "")
        if cc in ("Osservazione", "OBS_VALUE", "obs_value", "Value"):
            inv["value"] = c
        elif cc in ("ECON_ACTIVITY_NACE_2007", "HOM_TYPE_WORK", "GROUP_CATEGORY_COST", "E_COICOP_REV_ISTAT",
                     "MAIN_AGREEMENT_GROUP"):
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
    content = read_upload_limited(file)
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text), quotechar="'")
    mapping = _normalize_columns(reader)

    if not mapping.get("value") or not mapping.get("series_code") or not mapping.get("period"):
        raise HTTPException(400, "Formato CSV non riconosciuto. Colonne attese: ECON_ACTIVITY_NACE_2007 (o codici serie), TIME_PERIOD, Osservazione/OBS_VALUE")

    # ── Auto-rilevamento dataflow dalla colonna DATAFLOW del CSV ──────────
    df_config = None
    if mapping.get("dataflow"):
        for row in reader:
            df_val = row.get(mapping["dataflow"], "").strip()
            if df_val:
                df_id = _parse_dataflow_id(df_val)
                if df_id:
                    df_config = _find_dataflow_config(df_id)
                break
        # Re-crea il reader dopo il peek della prima riga
        reader = csv.DictReader(io.StringIO(text), quotechar="'")
        mapping = _normalize_columns(reader)

    if df_config:
        group_key = df_config.get("group_key", group_key or "istat")
        freq_param = df_config.get("frequency", freq_param or "monthly")
        series_names = {s["code"]: s["name"] for s in df_config.get("series", [])}
        contract_type = df_config.get("contract_type")
    else:
        series_names = {}
        contract_type = None
        group_key = group_key or "ps_business"
        freq_param = freq_param or "quarterly"

    freq = freq_param
    group_upper = group_key.upper()
    results = {"added": 0, "updated": 0, "skipped": 0, "errors": 0, "series_created": 0}

    for row in reader:
        try:
            code = row.get(mapping["series_code"], "").strip()
            period_str = row.get(mapping["period"], "").strip()
            val_str = row.get(mapping["value"], "").strip()
            status_raw = row.get(mapping.get("status") or "", "").strip()

            if not code or not period_str or not val_str:
                results["skipped"] += 1
                continue

            # Rileva frequenza dalla colonna FREQ del CSV (se presente)
            freq_col = mapping.get("freq")
            row_freq = row.get(freq_col, "").strip().lower() if freq_col else ""
            if row_freq in ("a", "y", "annuale"):
                row_freq = "annual"
            elif row_freq in ("m", "mensile"):
                row_freq = "monthly"
            elif row_freq in ("q", "trimestrale"):
                row_freq = "quarterly"
            else:
                row_freq = freq

            # Include MARKET nel series_id se presente
            market_suffix = ""
            market_col = mapping.get("market")
            if market_col:
                mkt_val = row.get(market_col, "").strip()
                if mkt_val:
                    market_suffix = f"_{mkt_val}"

            series_id = f"ISTAT_{group_upper}_{code}{market_suffix}"
            ref_period = _parse_period(period_str, row_freq)

            try:
                value = float(val_str.replace(",", "."))
            except ValueError:
                results["skipped"] += 1
                db.commit()
                continue

            # OBS_STATUS: P=provvisorio, E=stimato, M=manuale, T=provvisorio tendenza
            is_def = status_raw not in ("P", "E", "M", "T")

            # Nome descrittivo della serie
            name = series_names.get(code, f"{group_key} - {code}")
            desc_cols = [c for c in (reader.fieldnames or []) if "Attività" in c or "economica" in c]
            if desc_cols:
                desc_val = row.get(desc_cols[0], "").strip()
                if desc_val:
                    name = f"{group_key} - {desc_val}"

            # Crea la serie se non esiste
            series = db.query(IndexSeries).filter(IndexSeries.id == series_id).first()
            if not series:
                try:
                    series = IndexSeries(
                        id=series_id,
                        name=name,
                        source="ISTAT",
                        normative_category=contract_type or "services",
                        classification_ref=group_key,
                        frequency=row_freq,
                    )
                    db.add(series)
                    db.flush()
                    results["series_created"] += 1
                except Exception:
                    db.rollback()
                    series = db.query(IndexSeries).filter(IndexSeries.id == series_id).first()

            # Upsert osservazione
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
                results["updated"] += 1
            else:
                db.add(IndexObservation(
                    series_id=series_id,
                    ref_period=ref_period,
                    value=value,
                    is_definitive=is_def,
                ))
                results["added"] += 1

            db.commit()

        except Exception as e:
            db.rollback()
            results["errors"] += 1
            if results["errors"] <= 5:
                print(f"  ERR: row {row.get(mapping.get('series_code',''),'')} period={period_str} val={val_str}: {e}")

    return {
        "message": "Importazione completata",
        "details": results,
    }


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
    result = []
    for s in series_list:
        obs = (
            db.query(IndexObservation)
            .filter(IndexObservation.series_id == s.id)
            .order_by(IndexObservation.ref_period)
            .all()
        )
        result.append({
            "id": s.id,
            "name": s.name,
            "frequency": s.frequency,
            "normative_category": s.normative_category,
            "observation_count": len(obs),
            "observations": [
                {"period": o.ref_period.isoformat(), "value": o.value, "is_definitive": o.is_definitive}
                for o in obs
            ],
        })
    return result


@router.get("/{series_id}/observations")
def get_observations(series_id: str, db: Session = Depends(get_db)):
    obs = (
        db.query(IndexObservation)
        .filter(IndexObservation.series_id == series_id)
        .order_by(IndexObservation.ref_period.desc())
        .all()
    )
    return [
        {
            "id": o.id,
            "series_id": o.series_id,
            "ref_period": o.ref_period.isoformat(),
            "value": o.value,
            "is_definitive": o.is_definitive,
            "notes": o.notes,
        }
        for o in obs
    ]
