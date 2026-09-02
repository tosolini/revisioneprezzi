"""Script one-off per backfill query SDMX — riusa sdmx_backfill.

Usa lo stesso endpoint batch ma via CLI, senza HTTP.
Eseguibile via:
  docker compose exec backend python -m scripts.backfill_sdmx_queries [--dry-run] [--group ppi]
"""

import argparse
import sys

# assicurati che backend sia in path quando eseguito come `python -m scripts...`
sys.path.insert(0, ".")

from app.core.database import SessionLocal
from app.models.index_series import IndexSeries
from app.api.v1.indices import _latest_saved_queries
from app.services import sdmx_backfill
from app.api.v1.indices import _validate_sdmx_url
from app.services.indices_import import _load_dataflow_configs


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill IndexImportQuery per serie senza query")
    parser.add_argument("--dry-run", action="store_true", help="Simula senza scrivere")
    parser.add_argument("--group", dest="group", help="classification_ref (es. ppi)")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        q = db.query(IndexSeries)
        if args.group:
            # valida gruppo come fa l'endpoint
            try:
                configs = _load_dataflow_configs()
                allowed = {c.get("group_key") for c in configs if c.get("group_key")}
                allowed.update(sdmx_backfill.CLASSIFICATION_TO_EXPLORER.keys())
                if args.group not in allowed:
                    exists = (
                        db.query(IndexSeries)
                        .filter(IndexSeries.classification_ref == args.group)
                        .first()
                    )
                    if not exists:
                        msg = (
                            f"classification_ref sconosciuto: {args.group}. "
                            f"Ammessi: {sorted(allowed)}"
                        )
                        print(msg)
            except SystemExit:
                raise
            except Exception:
                pass
            q = q.filter(IndexSeries.classification_ref == args.group)
        series_list = q.order_by(IndexSeries.id).all()
        total = len(series_list)
        if total == 0:
            print("Nessuna serie trovata")
            return
        latest = _latest_saved_queries(db, [s.id for s in series_list])
        to_backfill = [s for s in series_list if s.id not in latest]
        print(f"Totale: {total}, da popolare: {len(to_backfill)}, dry_run={args.dry_run}")

        backfilled = 0
        skipped: list[dict] = []
        groups: dict[str, dict] = {}
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
                except Exception as e:
                    last_exc = e
                    continue
            if not normalized:
                skipped.append(
                    {"id": s.id, "reason": str(getattr(last_exc, "detail", last_exc))[:200]}
                )
                continue
            if args.dry_run:
                print(f"  [dry] {s.id} -> {normalized[:90]}...")
                backfilled += 1
                g = groups.get(normalized)
                if not g:
                    groups[normalized] = {
                        "dataflow_id": dataflow_id,
                        "key_part": key_part,
                        "series_ids": [s.id],
                    }
                else:
                    g["series_ids"].append(s.id)
                continue
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

        if not args.dry_run:
            from app.models.index_import_query import IndexImportQuery, IndexImportQuerySeries
            from app.api.v1.indices import _save_import_query

            for norm_url, grp in groups.items():
                try:
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
                        _save_import_query(
                            db, norm_url, grp["dataflow_id"], grp["key_part"], combined
                        )
                    else:
                        _save_import_query(
                            db, norm_url, grp["dataflow_id"], grp["key_part"], grp["series_ids"]
                        )
                    backfilled += len(grp["series_ids"])
                    print(f"  [ok] {norm_url[:90]}... -> {len(grp['series_ids'])} serie")
                except Exception as e:
                    for sid in grp["series_ids"]:
                        skipped.append({"id": sid, "reason": str(e)[:200]})
                    print(f"  [err] {norm_url[:60]}... {e}")

        print(
            f"\nRisultato: total={total} backfilled={backfilled} "
            f"skipped={len(skipped)} dry_run={args.dry_run}"
        )
        if skipped:
            print("Skipped:")
            for entry in skipped[:20]:
                print(f"  - {entry['id']}: {entry['reason']}")
            if len(skipped) > 20:
                print(f"  ... e altri {len(skipped) - 20}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
