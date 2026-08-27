"""Blocco sull'ordine dei periodi: il base deve precedere il confronto.

L'inversione cambierebbe il segno della variazione (un aumento diventerebbe
una decurtazione). Il blocco è aggirabile solo tramite override esplicito di
richiesta (force_inverted_periods), che nessun controllo UI espone.
"""

import uuid
from datetime import date

from app.models.index_observation import IndexObservation
from app.models.index_series import IndexSeries


def _make_series(db, base=100.0, comp=110.0):
    sid = f"PO_{uuid.uuid4().hex[:8]}"
    db.add(IndexSeries(id=sid, name="Test", source="TEST"))
    db.add(IndexObservation(
        series_id=sid, ref_period=date(2025, 4, 1), value=base, is_definitive=True
    ))
    db.add(IndexObservation(
        series_id=sid, ref_period=date(2026, 4, 1), value=comp, is_definitive=True
    ))
    db.flush()
    return sid


def test_calculate_rejects_inverted_periods(client, db):
    s = _make_series(db)
    db.commit()
    resp = client.post("/api/v1/calculation/v2/calculate", json={
        "contract_type": "services",
        "amount": 100000.0,
        "base_period": "2026-04-01",
        "comparison_period": "2025-04-01",
        "indices_config": {"type": "single", "single_series_id": s},
    })
    assert resp.status_code == 422
    assert "antecedente" in resp.json()["detail"]


def test_calculate_multi_component_rejects_inverted_periods(client, db):
    s1 = _make_series(db)
    s2 = _make_series(db)
    db.commit()
    resp = client.post("/api/v1/calculation/v2/calculate/multi-component", json={
        "contract_type": "services",
        "base_period": "2026-04-01",
        "comparison_period": "2025-04-01",
        "components": [
            {"amount": 50000.0, "description": "CPV1",
             "indices_config": {"type": "single", "single_series_id": s1}},
            {"amount": 50000.0, "description": "CPV2",
             "indices_config": {"type": "single", "single_series_id": s2}},
        ],
    })
    assert resp.status_code == 422
    assert "antecedente" in resp.json()["detail"]


def test_calculate_force_inverted_periods_override(client, db):
    """Override riservato: il calcolo procede e il segno è invertito."""
    s = _make_series(db, base=100.0, comp=110.0)
    db.commit()
    resp = client.post("/api/v1/calculation/v2/calculate", json={
        "contract_type": "services",
        "amount": 100000.0,
        "base_period": "2026-04-01",
        "comparison_period": "2025-04-01",
        "indices_config": {"type": "single", "single_series_id": s},
        "force_inverted_periods": True,
    })
    assert resp.status_code == 200, resp.text
    # base 110 (apr 2026), confronto 100 (apr 2025) → variazione negativa
    assert resp.json()["variation_percent"] == -9.0909


def test_calculate_accepts_ordered_and_equal_periods(client, db):
    s = _make_series(db, base=100.0, comp=110.0)
    db.commit()
    ok = client.post("/api/v1/calculation/v2/calculate", json={
        "contract_type": "services",
        "amount": 100000.0,
        "base_period": "2025-04-01",
        "comparison_period": "2026-04-01",
        "indices_config": {"type": "single", "single_series_id": s},
    })
    assert ok.status_code == 200
    assert ok.json()["variation_percent"] == 10.0

    eq = client.post("/api/v1/calculation/v2/calculate", json={
        "contract_type": "services",
        "amount": 100000.0,
        "base_period": "2025-04-01",
        "comparison_period": "2025-04-01",
        "indices_config": {"type": "single", "single_series_id": s},
    })
    assert eq.status_code == 200
    assert eq.json()["variation_percent"] == 0.0