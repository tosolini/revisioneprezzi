import uuid
from datetime import date

from app.core.database import SessionLocal
from app.models.index_observation import IndexObservation
from app.models.index_series import IndexSeries


def test_health_endpoint(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["app"] == "ok"
    assert resp.json()["database"] == "ok"


def _make_case(client, title="Test case"):
    resp = client.post("/api/v1/cases", json={"title": title})
    assert resp.status_code == 201
    return resp.json()["id"]


def test_create_case(client):
    cid = _make_case(client)
    resp = client.get(f"/api/v1/cases/{cid}")
    assert resp.status_code == 200
    assert resp.json()["title"] == "Test case"


def test_get_case_not_found(client):
    resp = client.get("/api/v1/cases/00000000-0000-0000-0000-000000000000")
    assert resp.status_code == 404


def test_update_case(client):
    cid = _make_case(client)
    resp = client.patch(f"/api/v1/cases/{cid}", json={"title": "Updated", "current_step": 3})
    assert resp.status_code == 200
    assert resp.json()["title"] == "Updated"
    assert resp.json()["current_step"] == 3


def test_delete_case(client):
    cid = _make_case(client)
    resp = client.delete(f"/api/v1/cases/{cid}")
    assert resp.status_code == 204
    resp = client.get(f"/api/v1/cases/{cid}")
    assert resp.status_code == 404


def test_wizard_save_and_read(client):
    cid = _make_case(client)
    save = client.post(f"/api/v1/cases/{cid}/wizard/1", json={
        "answers": [{"step": 1, "field_key": "contract_type", "field_value": "service"}]
    })
    assert save.status_code == 201
    read = client.get(f"/api/v1/cases/{cid}/wizard/1")
    assert read.status_code == 200
    assert len(read.json()) == 1
    assert read.json()[0]["field_value"] == "service"


def test_classify_endpoint(client):
    resp = client.post("/api/v1/classify", json={
        "cpv_primary": "90910000-9", "contract_type": "service"
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "candidates" in data
    assert "overall_confidence" in data


def test_indices_list(client):
    resp = client.get("/api/v1/indices")
    assert resp.status_code == 200


def test_calculate_endpoint(client):
    db = SessionLocal()
    sid = f"TST_API_{uuid.uuid4().hex[:6]}"
    db.add(IndexSeries(id=sid, name="API Test", source="TEST"))
    db.add(IndexObservation(series_id=sid, ref_period=date(2023, 1, 1), value=100.0, is_definitive=True))
    db.add(IndexObservation(series_id=sid, ref_period=date(2025, 1, 1), value=110.0, is_definitive=True))
    db.commit()
    db.close()

    cid = _make_case(client)
    resp = client.post("/api/v1/calculate", json={
        "case_id": cid, "series_id": sid,
        "base_period": "2023-01-01", "comparison_period": "2025-01-01", "amount": 100000.0,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["revision_amount"] == 4000.0


def test_report_generation(client):
    db = SessionLocal()
    sid = f"TST_RPT_{uuid.uuid4().hex[:6]}"
    db.add(IndexSeries(id=sid, name="Report Test", source="TEST"))
    db.add(IndexObservation(series_id=sid, ref_period=date(2023, 1, 1), value=100.0, is_definitive=True))
    db.add(IndexObservation(series_id=sid, ref_period=date(2025, 1, 1), value=110.0, is_definitive=True))
    db.commit()
    db.close()

    cid = _make_case(client)
    client.post("/api/v1/calculate", json={
        "case_id": cid, "series_id": sid,
        "base_period": "2023-01-01", "comparison_period": "2025-01-01", "amount": 100000.0,
    })
    resp = client.post(f"/api/v1/cases/{cid}/report")
    assert resp.status_code == 200
    assert "report" in resp.json()
