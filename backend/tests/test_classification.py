from app.services.classification_service import classify
from app.models.cpv_catalog import CpvCatalog
from app.models.family_mapping import FamilyMapping


def _ensure_cpv(db, code, desc):
    if not db.query(CpvCatalog).filter(CpvCatalog.cpv_code == code).first():
        db.add(CpvCatalog(cpv_code=code, description=desc))
        db.flush()


def _ensure_mapping(db, cpattern, family, strength):
    if not db.query(FamilyMapping).filter(FamilyMapping.cpv_pattern == cpattern).first():
        db.add(FamilyMapping(id=cpattern, cpv_pattern=cpattern, family=family, strength=strength))
        db.flush()


def test_classify_known_cpv(db):
    _ensure_mapping(db, "9091", "ppi_services", "high")
    result = classify("90910000-9", db, contract_type="service")
    assert "ppi_services" in [c["family"] for c in result["candidates"]]


def test_classify_unknown_cpv_returns_fallback(db):
    result = classify("99999999-9", db)
    assert len(result["candidates"]) >= 1
    assert result["overall_confidence"] == "low"
    assert result["requires_human_intervention"] is True
