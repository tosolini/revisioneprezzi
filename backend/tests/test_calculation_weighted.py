"""Test della media ponderata delle variazioni (Tabella D punto 7)."""

import uuid
from datetime import date

from app.models.index_observation import IndexObservation
from app.models.index_series import IndexSeries
from app.services.revision_calculation_v2 import calculate_price_revision


def _make_series(db, base=100.0, comp=110.0):
    sid = f"WV_{uuid.uuid4().hex[:8]}"
    db.add(IndexSeries(id=sid, name="Test", source="TEST"))
    db.add(IndexObservation(
        series_id=sid, ref_period=date(2025, 4, 1), value=base, is_definitive=True
    ))
    db.add(IndexObservation(
        series_id=sid, ref_period=date(2026, 4, 1), value=comp, is_definitive=True
    ))
    db.flush()
    return sid


def test_weighted_variation(db):
    s1 = _make_series(db, base=100.0, comp=110.0)   # +10%
    s2 = _make_series(db, base=200.0, comp=220.0)   # +10%
    db.commit()

    result = calculate_price_revision(
        db,
        contract_type="services",
        amount=100000.0,
        base_period=date(2025, 4, 1),
        comparison_period=date(2026, 4, 1),
        indices_config={
            "type": "composite",
            "method": "weighted_variations",
            "components": {s1: 20.0, s2: 80.0},
        },
    )
    assert "error" not in result
    # Vt = 0.2·10 + 0.8·10 = 10
    assert result["variation_percent"] == 10.0
    assert result["weighted_component_variations"] is not None
    assert len(result["weighted_component_variations"]) == 2
    details = {d["series_id"]: d for d in result["weighted_component_variations"]}
    assert details[s1]["variation_percent"] == 10.0
    assert details[s2]["variation_percent"] == 10.0
    assert details[s1]["weight"] == 20.0


def test_weighted_variation_mixed(db):
    s1 = _make_series(db, base=100.0, comp=110.0)   # +10%
    s2 = _make_series(db, base=100.0, comp=120.0)   # +20%
    db.commit()

    result = calculate_price_revision(
        db,
        contract_type="services",
        amount=100000.0,
        base_period=date(2025, 4, 1),
        comparison_period=date(2026, 4, 1),
        indices_config={
            "type": "composite",
            "method": "weighted_variations",
            "components": {s1: 20.0, s2: 80.0},
        },
    )
    assert result["variation_percent"] == 18.0  # 0.2·10 + 0.8·20


def test_weighted_variation_weights_must_sum_100(db):
    s1 = _make_series(db)
    db.commit()

    result = calculate_price_revision(
        db,
        contract_type="services",
        amount=100000.0,
        base_period=date(2025, 4, 1),
        comparison_period=date(2026, 4, 1),
        indices_config={
            "type": "composite",
            "method": "weighted_variations",
            "components": {s1: 20.0},
        },
    )
    assert "error" in result
    assert any("100%" in e for e in result["comparison_errors"])


def test_default_method_backward_compat(db):
    """Senza method il comportamento resta la media dei valori (TOL)."""
    s1 = _make_series(db, base=100.0, comp=110.0)
    s2 = _make_series(db, base=100.0, comp=110.0)
    db.commit()

    result = calculate_price_revision(
        db,
        contract_type="works",
        amount=100000.0,
        base_period=date(2025, 4, 1),
        comparison_period=date(2026, 4, 1),
        indices_config={
            "type": "composite",
            "components": {s1: 20.0, s2: 80.0},
        },
    )
    assert result["variation_percent"] == 10.0
    assert result["weighted_component_variations"] is None
