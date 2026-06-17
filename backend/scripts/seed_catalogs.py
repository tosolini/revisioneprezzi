"""Seed script: carica cataloghi CPV, serie ISTAT, family mappings, parametri normativi e osservazioni di esempio."""

import csv
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.database import SessionLocal
from app.models import FamilyDefinition
from app.models.cpv_catalog import CpvCatalog
from app.models.family_mapping import FamilyMapping
from app.models.index_observation import IndexObservation
from app.models.index_series import IndexSeries
from app.models.normative_param import NormativeParam

SEEDS_DIR = Path(__file__).resolve().parent.parent / "seeds"


def seed_cpv_catalog(db):
    path = SEEDS_DIR / "cpv_catalog.csv"
    if not path.exists():
        print(f"SKIP: {path} not found")
        return
    count = 0
    updated = 0
    with open(path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            existing = db.query(CpvCatalog).filter_by(cpv_code=row["cpv_code"]).first()
            if existing:
                if existing.description != row["description"]:
                    existing.description = row["description"]
                    updated += 1
            else:
                db.add(CpvCatalog(cpv_code=row["cpv_code"], description=row["description"]))
                count += 1
    db.commit()
    print(f"OK: {count} nuovi CPV inseriti, {updated} aggiornati")


def seed_index_series(db):
    path = SEEDS_DIR / "index_series.csv"
    if not path.exists():
        print(f"SKIP: {path} not found")
        return
    count = 0
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
                count += 1
    db.commit()
    print(f"OK: {count} ISTAT series loaded")


def seed_family_mappings(db):
    path = SEEDS_DIR / "family_mappings.csv"
    if not path.exists():
        print(f"SKIP: {path} not found")
        return
    count = 0
    with open(path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            existing = db.query(FamilyMapping).filter_by(cpv_pattern=row["cpv_pattern"]).first()
            if not existing:
                db.add(FamilyMapping(
                    id=row["cpv_pattern"],
                    cpv_pattern=row["cpv_pattern"],
                    family=row["family"],
                    strength=row["strength"],
                    mapping_note=row.get("mapping_note"),
                ))
                count += 1
    db.commit()
    print(f"OK: {count} family mappings loaded")


def seed_family_definitions(db):
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
    count = 0
    for d in definitions:
        existing = db.query(FamilyDefinition).filter_by(id=d.id).first()
        if not existing:
            db.add(d)
            count += 1
    db.commit()
    print(f"OK: {count} family definitions loaded")


def seed_normative_params(db):
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
    count = 0
    for p in params:
        existing = db.query(NormativeParam).filter_by(id=p.id).first()
        if not existing:
            db.add(p)
            count += 1
    db.commit()
    print(f"OK: {count} normative params loaded")


def seed_observations(db):
    path = SEEDS_DIR / "istat_observations_sample.csv"
    if not path.exists():
        print(f"SKIP: {path} not found")
        return
    count = 0
    with open(path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            series_id = row["series_id"].strip()
            series = db.query(IndexSeries).filter(IndexSeries.id == series_id).first()
            if not series:
                print(f"  WARN: unknown series '{series_id}', skipping")
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
                count += 1
    db.commit()
    print(f"OK: {count} observations loaded")


def main():
    db = SessionLocal()
    try:
        seed_cpv_catalog(db)
        seed_index_series(db)
        seed_family_definitions(db)
        seed_family_mappings(db)
        seed_normative_params(db)
        seed_observations(db)
        print("\nSeed completato.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
