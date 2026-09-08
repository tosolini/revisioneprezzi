"""Resume bozza V1: la versione wizard esplicita vince sulla ricostruzione V2."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session


def _new_case(client: TestClient) -> str:
    resp = client.post("/api/v1/cases", json={"title": "Resume version test"})
    assert resp.status_code == 201
    return resp.json()["id"]


def test_v1_draft_is_not_mistaken_for_v2(client: TestClient, db: Session):
    """Bozza solo-V1 (step 2+3, current_step 3): GET wizard-v2 ricostruisce i
    dati ma non deve risultare stato V2."""
    case_id = _new_case(client)
    resp = client.post(
        f"/api/v1/cases/{case_id}/wizard/2",
        json={
            "answers": [
                {"step": 2, "field_key": "contract_type", "field_value": "services"},
                {"step": 2, "field_key": "amount_subject_to_revision", "field_value": "50000"},
            ]
        },
    )
    assert resp.status_code == 201
    resp = client.post(
        f"/api/v1/cases/{case_id}/wizard/3",
        json={"answers": [{"step": 3, "field_key": "cpv_primary", "field_value": "50330000-7"}]},
    )
    assert resp.status_code == 201

    resp = client.get(f"/api/v1/cases/{case_id}/wizard-v2")
    assert resp.status_code == 200
    body = resp.json()
    # Ricostruzione ancora attiva (prefill V2), ma marcata come non-V2.
    assert body["state"]["current_step"] == 3
    assert body["state"]["amount"] == 50000.0
    assert body["has_v2_state"] is False
    assert body["wizard_version"] == "v1"


def test_version_markers_and_endpoint(client: TestClient, db: Session):
    case_id = _new_case(client)

    resp = client.get(f"/api/v1/cases/{case_id}/wizard-v2")
    assert resp.json()["wizard_version"] is None
    assert resp.json()["has_v2_state"] is False

    resp = client.put(f"/api/v1/cases/{case_id}/wizard-v2/version", json={"version": "v2"})
    assert resp.status_code == 200
    assert resp.json()["wizard_version"] == "v2"

    resp = client.get(f"/api/v1/cases/{case_id}/wizard-v2")
    assert resp.json()["wizard_version"] == "v2"
    assert resp.json()["has_v2_state"] is False

    resp = client.put(f"/api/v1/cases/{case_id}/wizard-v2/version", json={"version": "v3"})
    assert resp.status_code == 422

    # Il salvataggio V1 riporta il marcatore a v1.
    resp = client.post(
        f"/api/v1/cases/{case_id}/wizard/1",
        json={"answers": [{"step": 1, "field_key": "foo", "field_value": "bar"}]},
    )
    assert resp.status_code == 201
    resp = client.get(f"/api/v1/cases/{case_id}/wizard-v2")
    assert resp.json()["wizard_version"] == "v1"

    # Il salvataggio V2 marca v2 e crea lo stato salvato.
    resp = client.put(
        f"/api/v1/cases/{case_id}/wizard-v2",
        json={"current_step": 2, "contract_type": "services", "amount": 1000.0},
    )
    assert resp.status_code == 200
    resp = client.get(f"/api/v1/cases/{case_id}/wizard-v2")
    assert resp.json()["wizard_version"] == "v2"
    assert resp.json()["has_v2_state"] is True
