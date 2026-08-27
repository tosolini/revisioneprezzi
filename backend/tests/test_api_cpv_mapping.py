"""Test dell'endpoint POST /api/v1/classify/cpv-index-mapping."""

import pytest


@pytest.fixture()
def tabella_d_data(db):
    """Tabella D è popolata solo dopo `import_tabella_d --apply` (il file
    sorgente vive in `source/`, gitignorato): senza dati il mapping non può
    essere verificato e il test viene saltato, non fallito."""
    from app.models.tabella_d import CpvTabellaDMaster

    if db.query(CpvTabellaDMaster).count() == 0:
        pytest.skip("Tabella D non popolata: eseguire import_tabella_d --apply")
    return True


def test_cpv_index_mapping_d3(client, tabella_d_data):
    resp = client.post("/api/v1/classify/cpv-index-mapping", json={"cpv_code": "50330000-7"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["table_class"] == "D3"
    assert data["resolved_cpv_code"] == "50330000-7"
    assert len(data["associations"]) == 2
    by_type = {a["index_type"]: a for a in data["associations"]}
    assert by_type["PPI"]["ateco_code"] == "263"
    assert by_type["PPI"]["series_id"] == "ISTAT_PPI_263_D"
    assert by_type["IR"]["ateco_code"] == "951"
    assert by_type["IR"]["series_id"] == "ISTAT_RCO_SETT_S"


def test_cpv_index_mapping_d1(client, tabella_d_data):
    resp = client.post("/api/v1/classify/cpv-index-mapping", json={"cpv_code": "03211000-3"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["table_class"] == "D1"
    assert data["associations"][0]["index_type"] == "PC"
    assert data["associations"][0]["ateco_code"] == "0111"


def test_cpv_index_mapping_walkup(client, tabella_d_data):
    resp = client.post("/api/v1/classify/cpv-index-mapping", json={"cpv_code": "50334100-6"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["resolved_cpv_code"] == "50334000-5"
    assert data["table_class"] == "D3"


def test_cpv_index_mapping_unknown(client):
    resp = client.post("/api/v1/classify/cpv-index-mapping", json={"cpv_code": "99999999-9"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["table_class"] is None
    assert data["associations"] == []
