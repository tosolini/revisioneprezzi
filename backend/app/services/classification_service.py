from pathlib import Path
from typing import Any

import yaml
from sqlalchemy.orm import Session

from app.models.cpv_catalog import CpvCatalog
from app.models.family_mapping import FamilyMapping


def _load_rules() -> dict:
    path = Path(__file__).resolve().parent.parent / "rules" / "classification_rules.yaml"
    with open(path) as f:
        return yaml.safe_load(f)


RULES = _load_rules()


def _match_cpv_pattern(cpv: str, pattern: str) -> bool:
    return cpv.startswith(pattern)


def classify(cpv_primary: str, db: Session, contract_type: str | None = None,
             labour_intensive: bool | None = None,
             instant_execution: bool | None = None) -> dict[str, Any]:
    candidates = []
    questions = []
    warnings = []

    # 1. Cerca mapping nel DB (caricati da CSV seed)
    mappings = (
        db.query(FamilyMapping)
        .filter(FamilyMapping.cpv_pattern.isnot(None))
        .all()
    )
    for m in mappings:
        if cpv_primary.startswith(m.cpv_pattern):
            family_info = _get_family_info(m.family)
            strength_map = {"strong": "high", "medium": "medium", "weak": "low"}
            candidates.append({
                "family": m.family,
                "label": family_info.get("label", m.family) if family_info else m.family,
                "confidence": strength_map.get(m.strength, m.strength),
                "source": "cpv_mapping",
                "note": m.mapping_note,
            })

    # 2. Cerca descrizione CPV nel catalogo
    cpv_entry = db.query(CpvCatalog).filter(CpvCatalog.cpv_code == cpv_primary).first()
    cpv_description = cpv_entry.description if cpv_entry else None

    # 3. Valuta regole YAML per arricchire/raffinare
    for rule in RULES.get("rules", []):
        condition = rule.get("if", {})
        match = True

        if "cpv_pattern" in condition:
            if not _match_cpv_pattern(cpv_primary, condition["cpv_pattern"]):
                match = False

        if "contract_type" in condition:
            if contract_type != condition["contract_type"]:
                match = False

        if "labour_intensive" in condition:
            if labour_intensive != condition["labour_intensive"]:
                match = False

        if "instant_execution" in condition:
            if instant_execution != condition["instant_execution"]:
                match = False

        if match:
            then = rule.get("then", {})
            family = then.get("family")
            if family:
                family_info = _get_family_info(family)
                candidates.append({
                    "family": family,
                    "label": family_info.get("label", family) if family_info else family,
                    "confidence": then.get("confidence", "low"),
                    "source": "rule_engine",
                    "note": then.get("note", ""),
                })

            if "follow_up_questions" in rule:
                questions.extend(rule["follow_up_questions"])

    # 4. Rimuovi duplicati (stessa famiglia, confidenza più alta)
    seen = {}
    for c in candidates:
        fam = c["family"]
        if fam not in seen or _confidence_rank(c["confidence"]) > _confidence_rank(seen[fam]["confidence"]):
            seen[fam] = c
    candidates = list(seen.values())

    # 5. Se non ci sono candidati, mostra tutte le famiglie per scelta manuale
    if not candidates:
        warnings.append("Nessuna famiglia automatica trovata per il CPV specificato. Selezionare manualmente la famiglia revisionale appropriata tra quelle elencate.")
        for f in RULES.get("families", []):
            candidates.append({
                "family": f["id"],
                "label": f["label"],
                "confidence": "low",
                "source": "manual",
                "note": f.get("description", ""),
            })

    # 6. Determina confidenza complessiva
    max_conf = max((_confidence_rank(c["confidence"]) for c in candidates), default=0)
    if max_conf >= 3:
        overall_confidence = "high"
    elif max_conf >= 2:
        overall_confidence = "medium"
    else:
        overall_confidence = "low"

    return {
        "cpv_primary": cpv_primary,
        "cpv_description": cpv_description,
        "candidates": candidates,
        "questions": questions,
        "warnings": warnings,
        "overall_confidence": overall_confidence,
        "requires_human_intervention": overall_confidence == "low" or len(candidates) > 1,
    }


def _get_family_info(family_id: str | None) -> dict | None:
    if family_id is None:
        return None
    for f in RULES.get("families", []):
        if f["id"] == family_id:
            return f
    return None


def _confidence_rank(level: str) -> int:
    return {"high": 3, "medium": 2, "low": 1}.get(level, 0)
