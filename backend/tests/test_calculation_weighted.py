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

# ── Evidenza mesi non registrati (fallback per periodi senza dato) ──────────


def test_period_evidence_missing_months_single(db):
    """Confronto agosto 2026 con dato disponibile fino ad aprile 2026: il
    calcolo deve segnalare i mesi non registrati e il periodo usato."""
    s = _make_series(db, base=100.0, comp=110.0)
    db.commit()

    result = calculate_price_revision(
        db,
        contract_type="services",
        amount=100000.0,
        base_period=date(2025, 4, 1),
        comparison_period=date(2026, 8, 1),
        indices_config={"type": "single", "single_series_id": s},
    )
    assert "error" not in result
    pe = result["period_evidence"]
    assert pe["base"]["exact"] is True
    assert pe["base"]["missing_months"] == []
    assert pe["comparison"]["exact"] is False
    assert pe["comparison"]["used"] == "2026-04-01"
    assert pe["comparison"]["missing_months"] == [
        "2026-05", "2026-06", "2026-07", "2026-08",
    ]


def test_period_evidence_missing_months_composite(db):
    """Media ponderata: l'evidenza arriva anche a livello di singolo
    componente (pesi, periodo usato, mesi mancanti)."""
    s1 = _make_series(db, base=100.0, comp=110.0)
    s2 = _make_series(db, base=200.0, comp=220.0)
    db.commit()

    result = calculate_price_revision(
        db,
        contract_type="services",
        amount=100000.0,
        base_period=date(2025, 4, 1),
        comparison_period=date(2026, 8, 1),
        indices_config={
            "type": "composite",
            "method": "weighted_variations",
            "components": {s1: 50.0, s2: 50.0},
        },
    )
    assert "error" not in result
    pe = result["period_evidence"]
    assert pe["base"]["exact"] is True
    assert pe["comparison"]["exact"] is False
    assert pe["comparison"]["used"] == "2026-04-01"
    assert pe["comparison"]["missing_months"] == [
        "2026-05", "2026-06", "2026-07", "2026-08",
    ]
    d1 = next(d for d in result["weighted_component_variations"] if d["series_id"] == s1)
    assert d1["comparison_exact"] is False
    assert d1["missing_comparison_months"] == [
        "2026-05", "2026-06", "2026-07", "2026-08",
    ]
    assert d1["missing_base_months"] == []


def test_period_coverage_missing_months(db):
    from app.services.revision_calculation_v2 import calculate_period_coverage

    s1 = _make_series(db)
    db.commit()
    coverage = calculate_period_coverage(
        db, {s1: 100.0}, date(2025, 4, 1), date(2026, 8, 1)
    )
    row = coverage[0]
    assert row["satisfied"] is False
    assert row["base"]["exact"] is True
    assert row["comparison"]["exact"] is False
    assert row["comparison"]["missing_months"] == [
        "2026-05", "2026-06", "2026-07", "2026-08",
    ]


def test_missing_months_forward_fallback(db):
    """Richiesta prima della prima osservazione disponibile: il fallback è in
    avanti e i mesi mancanti partono dal mese richiesto."""
    sid = f"WV_{uuid.uuid4().hex[:8]}"
    db.add(IndexSeries(id=sid, name="Test", source="TEST"))
    db.add(IndexObservation(
        series_id=sid, ref_period=date(2026, 4, 1), value=100.0, is_definitive=True
    ))
    db.commit()

    result = calculate_price_revision(
        db,
        contract_type="services",
        amount=100000.0,
        base_period=date(2026, 1, 1),
        comparison_period=date(2026, 4, 1),
        indices_config={"type": "single", "single_series_id": sid},
    )
    assert "error" not in result
    pe = result["period_evidence"]
    assert pe["base"]["exact"] is False
    assert pe["base"]["used"] == "2026-04-01"
    assert pe["base"]["missing_months"] == ["2026-01", "2026-02", "2026-03"]
    assert pe["comparison"]["exact"] is True
