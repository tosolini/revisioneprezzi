from pathlib import Path
from typing import Any

import yaml
from sqlalchemy.orm import Session

from app.models.index_series import IndexSeries


def _load_rules() -> dict:
    path = Path(__file__).resolve().parent.parent / "rules" / "index_selection_rules.yaml"
    with open(path) as f:
        return yaml.safe_load(f)


RULES = _load_rules()


def get_candidate_series(family: str, db: Session) -> list[dict[str, Any]]:
    result = []
    mapping = None
    for m in RULES.get("mappings", []):
        if m["family"] == family:
            mapping = m
            break

    if not mapping:
        return result

    # Indice primario
    primary_series = db.query(IndexSeries).filter(
        IndexSeries.id == mapping["primary_series"]
    ).first()
    if primary_series:
        result.append({
            "id": primary_series.id,
            "name": primary_series.name,
            "source": primary_series.source,
            "normative_category": primary_series.normative_category,
            "classification_ref": primary_series.classification_ref,
            "frequency": primary_series.frequency,
            "is_primary": True,
            "rationale": mapping["selection_rationale"],
        })

    # Alternative
    for alt_id in mapping.get("alternatives", []):
        alt_series = db.query(IndexSeries).filter(IndexSeries.id == alt_id).first()
        if alt_series:
            result.append({
                "id": alt_series.id,
                "name": alt_series.name,
                "source": alt_series.source,
                "normative_category": alt_series.normative_category,
                "classification_ref": alt_series.classification_ref,
                "frequency": alt_series.frequency,
                "is_primary": False,
                "rationale": mapping["selection_rationale"],
            })

    return result


def get_selection_rationale(family: str) -> str | None:
    for m in RULES.get("mappings", []):
        if m["family"] == family:
            return m["selection_rationale"]
    return None
