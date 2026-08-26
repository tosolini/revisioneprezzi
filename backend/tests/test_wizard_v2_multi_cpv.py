"""Test della persistenza multi-CPV del wizard V2 (Art. 13)."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session


def _new_case(client: TestClient) -> str:
    resp = client.post("/api/v1/cases", json={"title": "Multi CPV test"})
    assert resp.status_code == 201
    return resp.json()["id"]


def test_put_get_multi_cpv(client: TestClient, db: Session):
    case_id = _new_case(client)

    payload = {
        "current_step": 2,
        "contract_type": "services",
        "cpv_selections": [
            {"cpv_code": "50330000-7", "description": "Manutenzione telecom", "weight": 60.0},
            {"cpv_code": "50334000-5", "description": "Riparazione telefoniche", "weight": 40.0},
        ],
        "ateco_selections": [
            {"ateco_code": "263", "weight": 20.0},
            {"ateco_code": "951", "weight": 80.0},
        ],
        "cpv_code": "50330000-7",
        "amount": 100000.0,
        "base_period": "2025-04-01",
        "comparison_period": "2026-04-01",
    }
    resp = client.put(f"/api/v1/cases/{case_id}/wizard-v2", json=payload)
    assert resp.status_code == 200

    resp = client.get(f"/api/v1/cases/{case_id}/wizard-v2")
    assert resp.status_code == 200
    state = resp.json()["state"]

    # Due CpvAssignment, il primo primary
    assert len(state["cpv_selections"]) == 2
    assert state["cpv_selections"][0]["cpv_code"] == "50330000-7"
    assert state["cpv_selections"][0]["weight"] == 60.0
    assert state["cpv_selections"][1]["cpv_code"] == "50334000-5"
    assert state["cpv_selections"][1]["weight"] == 40.0

    # ATECO persistito nel JSON di stato
    assert len(state["ateco_selections"]) == 2
    assert state["ateco_selections"][0] == {"ateco_code": "263", "weight": 20.0}
    assert state["ateco_selections"][1] == {"ateco_code": "951", "weight": 80.0}

    # Retro-compat lettura: cpv_code = primary
    assert state["cpv_code"] == "50330000-7"


def test_put_single_cpv_backward_compat(client: TestClient, db: Session):
    """Put con solo cpv_code (vecchio flusso) crea un unico assignment."""
    case_id = _new_case(client)

    payload = {
        "current_step": 2,
        "contract_type": "services",
        "cpv_code": "50330000-7",
        "amount": 50000.0,
    }
    resp = client.put(f"/api/v1/cases/{case_id}/wizard-v2", json=payload)
    assert resp.status_code == 200

    resp = client.get(f"/api/v1/cases/{case_id}/wizard-v2")
    state = resp.json()["state"]
    assert len(state["cpv_selections"]) == 1
    assert state["cpv_selections"][0]["cpv_code"] == "50330000-7"
    assert state["cpv_selections"][0]["weight"] is None
