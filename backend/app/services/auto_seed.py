"""Auto-seed catalogs at startup: idempotent, logs changes."""

import csv
import logging
from datetime import date
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models import FamilyDefinition, FamilyMapping, IndexObservation, IndexSeries, NormativeParam

_SEEDS_DIR = Path(__file__).resolve().parents[2] / "seeds"
_LOG = logging.getLogger("auto_seed")


def _log(msg: str) -> None:
    _LOG.info("[auto-seed] %s", msg)


def _seed_family_definitions(db: Session) -> None:
    definitions = [
        FamilyDefinition(
            id="consumer_or_supply",
            label="Indice prezzi al consumo / ECOICOP",
            description="Forniture riconducibili a paniere di consumo ISTAT",
        ),
        FamilyDefinition(
            id="ppi",
            label="Prezzi alla produzione industria (PPI)",
            description="Forniture riconducibili a settore produttivo ATECO",
        ),
        FamilyDefinition(
            id="ppi_services",
            label="Prezzi alla produzione servizi B2B",
            description="Servizi riconducibili a prezzi alla produzione servizi",
        ),
        FamilyDefinition(
            id="labour_index",
            label="Retribuzioni contrattuali orarie",
            description="Servizi a prevalente contenuto di manodopera",
        ),
    ]
    changes = 0
    for d in definitions:
        existing = db.query(FamilyDefinition).filter_by(id=d.id).first()
        if existing:
            if existing.label != d.label or existing.description != d.description:
                existing.label = d.label
                existing.description = d.description
                changes += 1
        else:
            db.add(d)
            changes += 1
    if changes:
        db.commit()
        _log(f"family_definitions: {changes} upserted")


def _seed_family_mappings(db: Session) -> None:
    path = _SEEDS_DIR / "family_mappings.csv"
    if not path.exists():
        _log(f"SKIP family_mappings: {path} not found")
        return
    changes = 0
    with open(path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            existing = db.query(FamilyMapping).filter_by(cpv_pattern=row["cpv_pattern"]).first()
            if existing:
                if (existing.family != row["family"]
                        or existing.strength != row["strength"]
                        or existing.mapping_note != row.get("mapping_note")):
                    existing.family = row["family"]
                    existing.strength = row["strength"]
                    existing.mapping_note = row.get("mapping_note")
                    changes += 1
            else:
                db.add(FamilyMapping(
                    id=row["cpv_pattern"],
                    cpv_pattern=row["cpv_pattern"],
                    family=row["family"],
                    strength=row["strength"],
                    mapping_note=row.get("mapping_note"),
                ))
                changes += 1
    if changes:
        db.commit()
        _log(f"family_mappings: {changes} upserted")


def _seed_normative_params(db: Session) -> None:
    params = [
        NormativeParam(
            id="activation_threshold",
            value=5.0,
            unit="percent",
            description="Soglia di attivazione della revisione prezzi",
            source="D.Lgs. 36/2023 art. 60",
        ),
        NormativeParam(
            id="recognition_rate",
            value=80.0,
            unit="percent",
            description="Percentuale riconoscibile della variazione eccedente la soglia",
            source="D.Lgs. 36/2023 art. 60",
        ),
    ]
    changes = 0
    for p in params:
        existing = db.query(NormativeParam).filter_by(id=p.id).first()
        if existing:
            if (existing.value != p.value or existing.unit != p.unit
                    or existing.description != p.description or existing.source != p.source):
                existing.value = p.value
                existing.unit = p.unit
                existing.description = p.description
                existing.source = p.source
                changes += 1
        else:
            db.add(p)
            changes += 1
    if changes:
        db.commit()
        _log(f"normative_params: {changes} upserted")


def _seed_index_series(db: Session) -> None:
    path = _SEEDS_DIR / "index_series.csv"
    if not path.exists():
        _log(f"SKIP index_series: {path} not found")
        return
    changes = 0
    with open(path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            existing = db.query(IndexSeries).filter_by(id=row["id"]).first()
            if not existing:
                db.add(IndexSeries(
                    id=row["id"],
                    name=row["name"],
                    source=row["source"],
                    normative_category=row.get("normative_category"),
                    classification_ref=row.get("classification_ref"),
                    frequency=row.get("frequency"),
                ))
                changes += 1
    if changes:
        db.commit()
        _log(f"index_series: {changes} inserted")


def _seed_observations(db: Session) -> None:
    path = _SEEDS_DIR / "istat_observations_sample.csv"
    if not path.exists():
        _log(f"SKIP observations: {path} not found")
        return
    changes = 0
    with open(path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            series_id = row["series_id"].strip()
            series = db.query(IndexSeries).filter(IndexSeries.id == series_id).first()
            if not series:
                continue
            ref_period = date.fromisoformat(row["ref_period"].strip())
            existing = (
                db.query(IndexObservation)
                .filter(
                    IndexObservation.series_id == series_id,
                    IndexObservation.ref_period == ref_period,
                )
                .first()
            )
            if not existing:
                db.add(IndexObservation(
                    series_id=series_id,
                    ref_period=ref_period,
                    value=float(row["value"]),
                    is_definitive=row["is_definitive"].strip().lower() in ("true", "1"),
                    notes=row.get("notes", "").strip() or None,
                ))
                changes += 1
    if changes:
        db.commit()
        _log(f"observations: {changes} inserted")


def auto_seed() -> None:
    """Idempotent seed of all catalog data. Safe to call on every startup."""
    _log("starting…")
    db = SessionLocal()
    try:
        _seed_family_definitions(db)
        _seed_family_mappings(db)
        _seed_normative_params(db)
        _seed_index_series(db)
        _seed_observations(db)
        _log("done")
    except Exception as exc:
        _log(f"ERROR: {exc}")
        raise
    finally:
        db.close()
