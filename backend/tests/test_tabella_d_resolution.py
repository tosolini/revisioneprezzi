"""Test del servizio di risoluzione CPV → Tabella D."""

import pytest

from app.services.tabella_d_service import (
    normalize_cpv,
    resolve_associations,
    resolve_series,
)


@pytest.fixture()
def tabella_d_data(db):
    """Tabella D è popolata solo dopo `import_tabella_d --apply` (file sorgente
    gitignorato in `source/`): senza dati la risoluzione non è verificabile e
    il test viene saltato, non fallito."""
    from app.models.tabella_d import CpvTabellaDMaster

    if db.query(CpvTabellaDMaster).count() == 0:
        pytest.skip("Tabella D non popolata: eseguire import_tabella_d --apply")
    return True


def test_normalize():
    assert normalize_cpv("50330000- 7") == "50330000-7"


def test_resolve_50330000(db, tabella_d_data):
    result = resolve_associations("50330000-7", db)
    assert result is not None
    assert result["table_class"] == "D3"
    assert result["resolved_cpv_code"] == "50330000-7"
    types = [(a["index_type"], a["ateco_code"]) for a in result["associations"]]
    assert ("PPI", "263") in types
    assert ("IR", "951") in types


def test_resolve_walkup(db, tabella_d_data):
    # 50334100-6 non è nel master; il padre 50334000-5 è D.3 (Art. 11.2d)
    result = resolve_associations("50334100-6", db)
    assert result is not None
    assert result["resolved_cpv_code"] == "50334000-5"
    assert result["table_class"] == "D3"


def test_resolve_unknown(db):
    assert resolve_associations("99999999-9", db) is None


def test_resolve_series_ppi(db):
    detail = resolve_series({"index_type": "PPI", "ateco_code": "263"}, db)
    assert detail["series_id"] == "ISTAT_PPI_263_D"


def test_resolve_series_ir(db):
    detail = resolve_series({"index_type": "IR", "ateco_code": "951"}, db)
    assert detail["series_id"] == "ISTAT_RCO_SETT_S"


def test_resolve_series_ir_section_letter(db):
    detail = resolve_series({"index_type": "IR", "ateco_code": "A"}, db)
    assert detail["series_id"] == "ISTAT_RCO_SETT_A"


def test_resolve_series_pps_fallback(db):
    detail = resolve_series({"index_type": "PPS", "ateco_code": "999"}, db)
    assert detail["series_id"] == "ISTAT_PS_BTOB_TOT"


def test_classification_d1_direct(db, tabella_d_data):
    result = resolve_associations("03211000-3", db)
    assert result is not None
    assert result["table_class"] == "D1"
    assoc = result["associations"][0]
    assert assoc["index_type"] == "PC"
    assert assoc["ateco_code"] == "0111"
    assert assoc["classification"] == "ECOICOP"
