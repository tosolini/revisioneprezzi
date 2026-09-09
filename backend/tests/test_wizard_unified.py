"""Wizard unificato 1.2.0: vocabolario canonico, flag operativi, date, meta pratica."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.contract_context import ContractContext


def _new_case(client: TestClient) -> str:
    resp = client.post("/api/v1/cases", json={"title": "Unified test"})
    assert resp.status_code == 201
    return resp.json()["id"]


def test_legacy_contract_type_canonicalized_and_synced(client: TestClient, db: Session):
    """PUT con forma legacy `service` → blob canonico + specchio ContractContext."""
    case_id = _new_case(client)
    resp = client.put(
        f"/api/v1/cases/{case_id}/wizard-v2",
        json={
            "current_step": 3,
            "contract_type": "service",
            "amount": 10000.0,
            "is_duration_contract": True,
            "instant_execution": False,
            "stipulation_date": "2024-01-10",
            "execution_start_date": "2024-01-15",
            "contract_end_date": "2025-01-15",
            "duration_months": 12,
        },
    )
    assert resp.status_code == 200

    body = client.get(f"/api/v1/cases/{case_id}/wizard-v2").json()
    assert body["state"]["contract_type"] == "services"
    assert body["state"]["is_duration_contract"] is True
    assert body["state"]["contract_end_date"] == "2025-01-15"
    assert body["wizard_version"] == "unified"

    contract = db.query(ContractContext).filter(ContractContext.case_id == case_id).first()
    assert contract is not None
    assert contract.contract_type == "services"
    assert contract.is_duration_contract is True
    assert contract.instant_execution is False
    assert contract.stipulation_date.isoformat() == "2024-01-10"
    assert contract.contract_end_date.isoformat() == "2025-01-15"
    assert contract.duration_months == 12


def test_v1_answers_visible_in_unified_get(client: TestClient, db: Session):
    """Pratica V1 esistente: date/flag legacy ereditati senza reinserimento."""
    case_id = _new_case(client)
    resp = client.post(
        f"/api/v1/cases/{case_id}/wizard/2",
        json={
            "answers": [
                {"step": 2, "field_key": "contract_type", "field_value": "supply"},
                {"step": 2, "field_key": "is_duration_contract", "field_value": "true"},
                {"step": 2, "field_key": "stipulation_date", "field_value": "2024-03-01"},
                {"step": 2, "field_key": "execution_start_date", "field_value": "2024-04-01"},
                {"step": 2, "field_key": "duration_months", "field_value": "6"},
            ]
        },
    )
    assert resp.status_code == 201

    body = client.get(f"/api/v1/cases/{case_id}/wizard-v2").json()
    assert body["state"]["contract_type"] == "supplies"
    assert body["state"]["is_duration_contract"] is True
    assert body["state"]["stipulation_date"] == "2024-03-01"
    assert body["state"]["duration_months"] == 6


def test_blob_values_win_over_projections(client: TestClient, db: Session):
    """Gap-fill: i valori del blob non sono mai sovrascritti dal fallback."""
    case_id = _new_case(client)
    client.put(
        f"/api/v1/cases/{case_id}/wizard-v2",
        json={
            "current_step": 3,
            "contract_type": "works",
            "amount": 5000.0,
            "execution_start_date": "2024-05-01",
            "duration_months": 6,
        },
    )
    # Cancellazione esplicita nel blob → specchio azzerato, nessun resurrect.
    client.put(
        f"/api/v1/cases/{case_id}/wizard-v2",
        json={"current_step": 3, "contract_type": "works", "amount": 5000.0},
    )
    body = client.get(f"/api/v1/cases/{case_id}/wizard-v2").json()
    assert body["state"]["execution_start_date"] is None
    assert body["state"]["duration_months"] is None


def test_practice_meta_and_report_keys(client: TestClient, db: Session):
    """KV step 0 lotto/operatore → report S1; date/flag → S1/S3, null se assenti."""
    case_id = _new_case(client)
    resp = client.put(
        f"/api/v1/cases/{case_id}/practice-meta",
        json={"lotto": "Lotto 2", "operatore_economico": "ACME S.p.A."},
    )
    assert resp.status_code == 200
    assert resp.json()["lotto"] == "Lotto 2"

    report = client.get(f"/api/v1/report/v2/cases/{case_id}").json()
    by_title = {s["title"]: s["data"] for s in report["sections"]}
    assert by_title["Dati Contratto"]["lotto"] == "Lotto 2"
    assert by_title["Dati Contratto"]["operatore_economico"] == "ACME S.p.A."
    assert by_title["Dati Contratto"]["is_duration_contract"] is None
    assert by_title["Importi e Date"]["contract_end_date"] is None
    assert by_title["Importi e Date"]["duration_months"] is None

    client.put(
        f"/api/v1/cases/{case_id}/wizard-v2",
        json={
            "current_step": 1,
            "contract_type": "mixed",
            "instant_execution": True,
            "contract_end_date": "2025-06-30",
            "duration_months": 12,
        },
    )
    report = client.get(f"/api/v1/report/v2/cases/{case_id}").json()
    by_title = {s["title"]: s["data"] for s in report["sections"]}
    assert by_title["Dati Contratto"]["instant_execution"] is True
    assert by_title["Dati Contratto"]["contract_type_label"] == "Misto servizi-forniture"
    assert by_title["Importi e Date"]["contract_end_date"] == "2025-06-30"
    assert by_title["Importi e Date"]["duration_months"] == 12

def test_s6_calc_keys_single_and_multi(client: TestClient, db: Session):
    """S6 espone passi+excess/recognition (singolo) e righe per-componente (multi)."""
    case_id = _new_case(client)
    steps = [
        {"step": 0, "description": "Parametri normativi applicabili",
         "details": {"tipo_contratto": "services", "soglia_attivazione": "5.0%",
                      "coefficiente_riconoscimento": "80.0%", "riferimento": "Art. 3"},
         "result": "Soglia 5.0%, Coefficiente 80.0%"},
        {"step": 1, "description": "Recupero indici ISTAT",
         "details": {"serie": "ISTAT_X", "periodo_base": "2024-01-01", "valore_base": 100.0,
                      "periodo_confronto": "2025-01-01", "valore_confronto": 108.0},
         "result": "Indice base: 100.0, Indice confronto: 108.0"},
        {"step": 2, "description": "Calcolo variazione percentuale",
         "formula": "((I_confronto - I_base) / I_base) × 100",
         "calculation": "((108.0 - 100.0) / 100.0) × 100", "result": "8.0%"},
    ]
    resp = client.post(
        f"/api/v1/report/v2/cases/{case_id}/calculation",
        json={
            "variation_percent": 8.0,
            "threshold_percent": 5.0,
            "excess_percent": 3.0,
            "recognition_percent": 80.0,
            "revision_amount": 2400.0,
            "steps": steps,
        },
    )
    assert resp.status_code == 200
    sections = client.get(f"/api/v1/report/v2/cases/{case_id}").json()["sections"]
    s6 = {s["title"]: s["data"] for s in sections}["Risultato Calcolo"]
    assert s6["excess_percent"] == 3.0
    assert s6["recognition_percent"] == 80.0
    assert [st["step"] for st in s6["formula_steps"]] == [0, 1, 2]
    assert s6["formula_steps"][2]["formula"] == "((I_confronto - I_base) / I_base) × 100"
    assert s6["components"] is None

    multi_id = _new_case(client)
    blob = {
        "current_step": 5,
        "contract_type": "services",
        "amount": 100000.0,
        "result": {
            "is_multi_component": True,
            "overall_variation_percent": 6.0,
            "threshold_percent": 5.0,
            "components": [
                {"description": "Servizi", "amount": 60000.0,
                 "result": {"variation_percent": 7.0, "revision_amount": 1000.0}},
                {"description": "Forniture", "amount": 40000.0,
                 "result": {"variation_percent": 4.5, "revision_amount": 500.0}},
            ],
        },
    }
    assert client.put(f"/api/v1/cases/{multi_id}/wizard-v2", json=blob).status_code == 200
    sections_m = client.get(f"/api/v1/report/v2/cases/{multi_id}").json()["sections"]
    s6m = {s["title"]: s["data"] for s in sections_m}["Risultato Calcolo"]
    assert s6m["components"] == [
        {"description": "Servizi", "amount": 60000.0,
         "variation_percent": 7.0, "revision_amount": 1000.0},
        {"description": "Forniture", "amount": 40000.0,
         "variation_percent": 4.5, "revision_amount": 500.0},
    ]