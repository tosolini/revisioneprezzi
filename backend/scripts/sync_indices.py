#!/usr/bin/env python3
"""
Script per sincronizzare le serie ISTAT.
Supporta:
  1. Importazione da file CSV locale:  python sync_indices.py datasets.csv
  2. Download automatico da API SDMX ISTAT:  python sync_indices.py --sync
  3. Export template CSV:  python sync_indices.py --export-template template.csv
"""

import csv
import json
import random
import sys
import time
import uuid
from datetime import date, datetime
from pathlib import Path

import requests
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.database import SessionLocal
from app.models.index_observation import IndexObservation
from app.models.index_series import IndexSeries

CONFIG_PATH = Path(__file__).resolve().parent.parent / "seeds" / "istat_data_config.yaml"
SYNC_STATE_PATH = Path(__file__).resolve().parent.parent / "seeds" / ".istat_sync_state.json"
SDMX_BASE = "https://esploradati.istat.it/SDMXWS/rest/data"

_last_request_time = 0.0


def _wait_rate_limit():
    global _last_request_time
    now = time.time()
    if now - _last_request_time < 12:
        sleep = 12 - (now - _last_request_time) + random.uniform(0.5, 2)
        print(f"  Rate limit: attesa {sleep:.1f}s...")
        time.sleep(sleep)
    _last_request_time = time.time()


def _download(url: str, params: dict) -> str | None:
    for attempt in range(3):
        try:
            resp = requests.get(url, params=params, headers={"Accept": "text/csv"},
                                timeout=300)
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", 60))
                print(f"  Rate limit (429), riprovo tra {retry_after}s...")
                time.sleep(retry_after + random.uniform(1, 5))
                continue
            if resp.status_code != 200:
                print(f"  ERRORE HTTP {resp.status_code}: {resp.text[:200]}")
                return None
            return resp.text
        except requests.exceptions.Timeout:
            if attempt < 2:
                print(f"  Timeout, tentativo {attempt + 1}/3...")
                time.sleep(5)
                continue
            print(f"  ERRORE download (timeout dopo 3 tentativi)")
            return None
        except Exception as e:
            print(f"  ERRORE download: {e}")
            return None
    return None


def _parse_sdmx_csv(db, content: str, df_id: str, df_config: dict, results: dict,
                    freq: str, desc: str):
    dm = df_config["dimension_map"]
    series_code_col = dm["series_code"]
    value_col = dm["value"]
    period_col = dm["period"]
    reader = csv.DictReader(content.splitlines())
    dataflow_series = {s["code"]: s["name"] for s in df_config.get("series", [])}
    row_count = 0

    for row in reader:
        try:
            code = row.get(series_code_col, "").strip()
            period_str = row.get(period_col, "").strip()
            val_str = row.get(value_col, "").strip()

            if not code or not period_str or not val_str:
                results["skipped"] += 1
                continue

            group = df_config.get("group_key", "istat")
            series_id = f"ISTAT_{group.upper()}_{code}"
            name = dataflow_series.get(code, f"{desc} - {code}")
            ct = df_config.get("contract_type")

            _ensure_series(db, series_id, name, ct, group, df_id)

            if freq == "annual":
                ref_period = date.fromisoformat(f"{period_str[:4]}-01-01")
            elif freq == "monthly":
                if len(period_str) == 7 and period_str[4] == "-":
                    ref_period = date.fromisoformat(f"{period_str}-01")
                else:
                    ref_period = date.fromisoformat(period_str[:10])
            elif freq == "quarterly":
                year, q = period_str.split("-")
                month = {"Q1": "01", "Q2": "04", "Q3": "07", "Q4": "10"}.get(q, "01")
                ref_period = date.fromisoformat(f"{year}-{month}-01")
            else:
                ref_period = datetime.strptime(period_str[:10], "%Y-%m-%d").date()

            value = float(val_str)
            is_def = row.get("OBS_STATUS", "") not in ("P", "E", "M")

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

            row_count += 1

        except Exception as e:
            db.rollback()
            print(f"  ERRORE riga: {e}")
            print(f"    row: {dict(row)}")
            results["errors"] += 1

    return row_count


def _load_config():
    with open(CONFIG_PATH) as f:
        return yaml.safe_load(f)


def _load_sync_state() -> dict:
    if SYNC_STATE_PATH.exists():
        with open(SYNC_STATE_PATH) as f:
            return json.load(f)
    return {}


def _save_sync_state(state: dict):
    SYNC_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(SYNC_STATE_PATH, "w") as f:
        json.dump(state, f, indent=2, default=str)


def _ensure_series(db, series_id: str, name: str, contract_type: str | None = None,
                   group_key: str | None = None, dataflow_id: str | None = None) -> IndexSeries:
    series = db.query(IndexSeries).filter(IndexSeries.id == series_id).first()
    if series:
        if name and series.name != name:
            series.name = name
        return series
    try:
        series = IndexSeries(
            id=series_id,
            name=name,
            source="ISTAT",
            normative_category=contract_type,
            classification_ref=group_key,
            notes=f"Dataflow SDMX: {dataflow_id}" if dataflow_id else None,
            frequency="monthly",
        )
        db.add(series)
        db.flush()
        return series
    except Exception:
        db.rollback()
        series = db.query(IndexSeries).filter(IndexSeries.id == series_id).first()
        if series:
            return series
        raise


def sync_from_sdmx(db, dataflow_filter: str | None = None) -> dict[str, int]:
    """Scarica dati da API SDMX ISTAT secondo la configurazione."""
    config = _load_config()
    sync_state = _load_sync_state()
    results = {"added": 0, "updated": 0, "skipped": 0, "errors": 0, "series_created": 0}

    for df_config in config.get("dataflows", []):
        if dataflow_filter and df_config.get("dataflow_id") != dataflow_filter:
            continue
        df_id = df_config["dataflow_id"]
        desc = df_config.get("description", df_id)
        dm = df_config["dimension_map"]
        series_code_col = dm["series_code"]
        value_col = dm["value"]
        period_col = dm["period"]
        freq = df_config.get("frequency", "monthly")

        print(f"\n{'='*60}")
        print(f"Dataflow: {df_id}")
        print(f"  {desc}")

        # Determine sync window
        last_sync = sync_state.get(df_id)
        params_base = {"format": "csv"}

        if last_sync:
            dt = datetime.fromisoformat(last_sync)
            params_base["updatedAfter"] = dt.strftime("%Y-%m-%dT%H:%M:%S")
            print(f"  Incrementale da: {last_sync}")
            _wait_rate_limit()
            url = f"{SDMX_BASE}/{df_id}"
            content = _download(url, params_base)
            if content is None:
                results["errors"] += 1
                continue
            if not content:
                print("  Nessun dato restituito")
                continue
            contents = [content]
        else:
            # First sync: scarica anno per anno per evitare timeout
            current_year = date.today().year
            contents = []
            for year in range(2022, current_year + 1):
                params = dict(params_base, startPeriod=str(year), endPeriod=str(year))
                _wait_rate_limit()
                print(f"  Scarico anno {year}...")
                url = f"{SDMX_BASE}/{df_id}"
                content = _download(url, params)
                if content is None:
                    print(f"  Anno {year} saltato (errore)")
                    continue
                if content:
                    contents.append(content)

        df_rows = 0
        for content in contents:
            df_rows += _parse_sdmx_csv(db, content, df_id, df_config, results, freq, desc)

        print(f"  Righe processate nel dataflow: {df_rows}")
        sync_state[df_id] = datetime.now().isoformat()
        db.commit()
        _save_sync_state(sync_state)

    return results


def sync_from_csv(csv_path: str, db) -> dict[str, int]:
    results = {"added": 0, "updated": 0, "skipped": 0, "errors": 0}
    path = Path(csv_path)

    if not path.exists():
        print(f"ERRORE: file non trovato: {path}")
        results["errors"] += 1
        return results

    with open(path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                series_id = row.get("series_id", "").strip()
                ref_period_str = row.get("ref_period", "").strip()
                value_str = row.get("value", "").strip()
                is_def_str = row.get("is_definitive", "false").strip()

                if not series_id or not ref_period_str or not value_str:
                    results["skipped"] += 1
                    continue

                series = db.query(IndexSeries).filter(
                    IndexSeries.id == series_id
                ).first()
                if not series:
                    print(f"  WARN: serie sconosciuta: {series_id}")
                    results["skipped"] += 1
                    continue

                ref_period = datetime.strptime(ref_period_str, "%Y-%m-%d").date()
                value = float(value_str)
                is_definitive = is_def_str.lower() in ("true", "1", "yes")

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
                    existing.is_definitive = is_definitive
                    existing.notes = row.get("notes", existing.notes)
                    results["updated"] += 1
                else:
                    db.add(IndexObservation(
                        series_id=series_id,
                        ref_period=ref_period,
                        value=value,
                        is_definitive=is_definitive,
                        notes=row.get("notes", ""),
                    ))
                    results["added"] += 1

            except Exception as e:
                print(f"  ERRORE riga {row}: {e}")
                results["errors"] += 1

    db.commit()
    return results


def sync_from_sdmx_csv(csv_path: str, dataflow_id: str, db) -> dict[str, int]:
    """Importa un file CSV in formato SDMX (scaricato da ISTAT) usando la configurazione YAML.
    Legge il file a righe senza caricarlo in memoria, adatto per file grandi (es. 50+ MB).
    Usa INSERT ON CONFLICT DO UPDATE per upsert, una riga alla volta per evitare
    l'errore PostgreSQL 'ON CONFLICT DO UPDATE command cannot affect row a second time'."""
    results = {"added": 0, "updated": 0, "skipped": 0, "errors": 0, "series_created": 0}
    config = _load_config()

    df_config = None
    for df in config.get("dataflows", []):
        if df["dataflow_id"] == dataflow_id:
            df_config = df
            break
    if not df_config:
        print(f"ERRORE: dataflow '{dataflow_id}' non trovato in istat_data_config.yaml")
        results["errors"] += 1
        return results

    path = Path(csv_path)
    if not path.exists():
        print(f"ERRORE: file non trovato: {path}")
        results["errors"] += 1
        return results

    dm = df_config["dimension_map"]
    series_code_col = dm["series_code"]
    value_col = dm["value"]
    period_col = dm["period"]
    freq = df_config.get("frequency", "monthly")
    desc = df_config.get("description", dataflow_id)
    group = df_config.get("group_key", "istat")
    dataflow_series = {s["code"]: s["name"] for s in df_config.get("series", [])}

    file_size = path.stat().st_size
    print(f"File: {path.name} ({file_size / 1024 / 1024:.1f} MB)")
    print(f"Dataflow: {dataflow_id} | Mappatura: {series_code_col} → series_code")

    # Pre-carica le serie esistenti per evitarne la ricreazione
    existing_series = {s.id for s in db.query(IndexSeries.id).all()}
    created_series = set()

    IndexObservationTable = IndexObservation.__table__

    batch = []
    BATCH_SIZE = 5000
    total_processed = 0

    with open(path, newline="") as f:
        reader = csv.DictReader(f)

        for row in reader:
            try:
                if row.get("MEASURE", "").strip() != "4":
                    results["skipped"] += 1
                    continue

                code = row.get(series_code_col, "").strip()
                period_str = row.get(period_col, "").strip()
                val_str = row.get(value_col, "").strip()

                if not code or not period_str or not val_str:
                    results["skipped"] += 1
                    continue

                series_id = f"ISTAT_{group.upper()}_{code}"

                if series_id not in existing_series and series_id not in created_series:
                    name = dataflow_series.get(code, f"{desc} - {code}")
                    _ensure_series(db, series_id, name, df_config.get("contract_type"), group, dataflow_id)
                    created_series.add(series_id)

                if freq == "annual":
                    ref_period = date.fromisoformat(f"{period_str[:4]}-01-01")
                elif freq == "monthly":
                    if len(period_str) == 7 and period_str[4] == "-":
                        ref_period = date.fromisoformat(f"{period_str}-01")
                    else:
                        ref_period = date.fromisoformat(period_str[:10])
                elif freq == "quarterly":
                    year, q = period_str.split("-")
                    month = {"Q1": "01", "Q2": "04", "Q3": "07", "Q4": "10"}.get(q, "01")
                    ref_period = date.fromisoformat(f"{year}-{month}-01")
                else:
                    ref_period = datetime.strptime(period_str[:10], "%Y-%m-%d").date()

                value = float(val_str)
                obs_status = row.get("OBS_STATUS", "").strip()
                is_def = obs_status not in ("P", "E", "M")

                batch.append({
                    "id": uuid.uuid4(),
                    "series_id": series_id,
                    "ref_period": ref_period,
                    "value": value,
                    "is_definitive": is_def,
                })

                if len(batch) >= BATCH_SIZE:
                    try:
                        _flush_batch(db, IndexObservationTable, batch, results)
                    except Exception as e:
                        db.rollback()
                        print(f"  ERRORE batch flush ({len(batch)} righe): {e}")
                        results["errors"] += len(batch)
                        batch = []
                        continue
                    total_processed += len(batch)
                    batch = []
                    db.commit()
                    print(f"  Processate {total_processed} righe...")

            except Exception as e:
                db.rollback()
                print(f"  ERRORE riga: {e}")
                results["errors"] += 1

    if batch:
        try:
            _flush_batch(db, IndexObservationTable, batch, results)
        except Exception as e:
            db.rollback()
            print(f"  ERRORE batch flush finale ({len(batch)} righe): {e}")
            results["errors"] += len(batch)
            batch = []
        total_processed += len(batch)

    db.commit()
    print(f"  Totale righe processate: {total_processed}")
    print(f"  Serie create: {len(created_series)}")
    return results


def _flush_batch(session, table, batch: list[dict], results: dict) -> int:
    """Esegue upsert via INSERT ... ON CONFLICT DO UPDATE una riga alla volta.
    Il CSV contiene righe duplicate (stessa serie/periodo, basi diverse):
    vengono deduplicate tenendo l'ultima occorrenza.
    
    Usiamo un INSERT per riga invece che bulk perché PostgreSQL non permette
    ON CONFLICT DO UPDATE con righe multiple che mappano allo stesso target
    (errore 'cannot affect row a second time')."""
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from sqlalchemy import text

    seen = {}
    for row in batch:
        key = (row["series_id"], row["ref_period"])
        seen[key] = row
    deduped = list(seen.values())

    for row in deduped:
        stmt = pg_insert(table).values([row])
        stmt = stmt.on_conflict_do_update(
            index_elements=["series_id", "ref_period"],
            set_={
                "value": stmt.excluded.value,
                "is_definitive": stmt.excluded.is_definitive,
            },
        )
        result = session.execute(stmt)
        if result.rowcount > 0 and result.inserted_primary_key:
            results["added"] += 1
        else:
            results["updated"] += 1

    return len(deduped)


def export_template(csv_path: str):
    path = Path(csv_path)
    with open(path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["series_id", "ref_period", "value", "is_definitive", "notes"])
        writer.writerow(["ISTAT_PPI_MAN", "2024-01-01", "110.5", "true", ""])
        writer.writerow(["ISTAT_PPI_MAN", "2025-01-01", "115.2", "false", "dato provvisorio"])
    print(f"Template creato: {path}")


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Sincronizza osservazioni ISTAT")
    parser.add_argument("csv_path", nargs="?", help="Percorso file CSV da importare")
    parser.add_argument("--sync", action="store_true", help="Scarica dati da API SDMX ISTAT")
    parser.add_argument("--dataflow", help="ID dataflow specifico da sincronizzare (es. 145_376_DF_DCSC_PREZPRODSERV_1_7)")
    parser.add_argument("--export-template", help="Crea file CSV template in questo path")
    parser.add_argument("--dry-run", action="store_true", help="Simula senza scrivere")
    parser.add_argument("--import-sdmx-csv", help="Importa file CSV in formato SDXM locale (usa --dataflow per specificare il dataflow)")
    args = parser.parse_args()

    if args.import_sdmx_csv:
        if not args.dataflow:
            print("ERRORE: --import-sdmx-csv richiede anche --dataflow <ID>")
            sys.exit(1)
        db = SessionLocal()
        try:
            print(f"=== Importazione file SDMX CSV ===")
            print(f"  File: {args.import_sdmx_csv}")
            print(f"  Dataflow: {args.dataflow}")
            results = sync_from_sdmx_csv(args.import_sdmx_csv, args.dataflow, db)
            print(f"\nRisultati:")
            print(f"  Osservazioni aggiunte: {results['added']}")
            print(f"  Osservazioni aggiornate: {results['updated']}")
            print(f"  Saltate: {results['skipped']}")
            print(f"  Errori: {results['errors']}")
        finally:
            db.close()
        return

    if args.export_template:
        export_template(args.export_template)
        return

    if args.sync:
        print("=== Sincronizzazione da API SDMX ISTAT ===")
        if args.dataflow:
            print(f"  Dataflow filtrato: {args.dataflow}")
        db = SessionLocal()
        try:
            results = sync_from_sdmx(db, dataflow_filter=args.dataflow)
            print(f"\nRisultati totali:")
            print(f"  Serie create: {results['series_created']}")
            print(f"  Osservazioni aggiunte: {results['added']}")
            print(f"  Osservazioni aggiornate: {results['updated']}")
            print(f"  Saltate: {results['skipped']}")
            print(f"  Errori: {results['errors']}")
        finally:
            db.close()
        return

    if not args.csv_path:
        parser.print_help()
        return

    db = SessionLocal()
    try:
        print(f"Importazione da: {args.csv_path}")
        results = sync_from_csv(args.csv_path, db)
        print(f"\nRisultati: {results['added']} aggiunti, {results['updated']} aggiornati, "
              f"{results['skipped']} saltati, {results['errors']} errori")
    finally:
        db.close()


if __name__ == "__main__":
    main()
