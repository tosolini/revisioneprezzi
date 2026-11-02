"""Test per il raccordo basi ISTAT (Base 2015 -> Base 2025) e IndexBaseLink."""

from datetime import date
import pytest

from app.core.database import SessionLocal
from app.models.index_base_link import IndexBaseLink
from app.services.base_link_service import resolve_base_link
from app.services.revision_calculation_v2 import (
    calculate_price_revision,
    calculate_weighted_variation,
)
from app.services.calculation_service import calculate_single


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def test_base_links_seeded(db):
    """Verifica che index_base_link contenga i coefficienti ufficiali per le serie NIC."""
    count = db.query(IndexBaseLink).count()
    assert count >= 200, f"Attesi almeno 200 link di raccordo, trovati {count}"

    gen_link = db.query(IndexBaseLink).filter_by(
        from_series_id="ISTAT_NIC_ECOICOP2_00",
        to_series_id="ISTAT_NIC_ECOICOP2_00"
    ).first()
    assert gen_link is not None
    assert gen_link.reference_period == date(2026, 1, 1)
    assert 1.20 <= float(gen_link.coefficient) <= 1.25


def test_resolve_base_link_crossing_boundary(db):
    """Verifica che un intervallo che attraversa il 2026-01-01 attivi il raccordo."""
    res = resolve_base_link(
        db,
        series_id="ISTAT_NIC_ECOICOP2_00",
        base_period=date(2025, 10, 1),
        comparison_period=date(2026, 2, 1),
        comp_value=100.7,
    )
    assert res.applied is True
    assert res.coefficient > 1.20
    assert res.homogenized_comp_value is not None
    assert res.homogenized_comp_value > 120.0
    assert "raccordo ISTAT" in (res.note or "")


def test_resolve_base_link_not_applied_same_base(db):
    """Verifica che periodi nella stessa base NON applichino alcun raccordo."""
    # Entrambi nel 2025 (base 2015)
    res_2025 = resolve_base_link(
        db,
        series_id="ISTAT_NIC_ECOICOP2_00",
        base_period=date(2025, 3, 1),
        comparison_period=date(2025, 11, 1),
        comp_value=122.7,
    )
    assert res_2025.applied is False

    # Entrambi nel 2026 (base 2025)
    res_2026 = resolve_base_link(
        db,
        series_id="ISTAT_NIC_ECOICOP2_00",
        base_period=date(2026, 1, 1),
        comparison_period=date(2026, 4, 1),
        comp_value=102.3,
    )
    assert res_2026.applied is False


def test_calculate_price_revision_v2_crossing_boundary(db):
    """Verifica che il calcolo v2 a cavallo 2025/26 dia variazione coerente (+0.81%) e non -18%."""
    res = calculate_price_revision(
        db=db,
        contract_type="services",
        amount=100000.0,
        base_period=date(2025, 10, 1),
        comparison_period=date(2026, 2, 1),
        indices_config={
            "type": "single",
            "single_series_id": "ISTAT_NIC_ECOICOP2_00",
        },
    )
    assert "error" not in res
    assert res["base_link_applied"] is True
    assert res["base_value"] == 123.2
    assert res["comparison_value"] == 100.7
    assert res["homogenized_comparison_value"] is not None
    assert res["homogenized_comparison_value"] > 124.0

    # La variazione deve essere positiva e modesta (circa +0.81%) e NON un crollo del -18%
    assert 0.0 < res["variation_percent"] < 2.0
    assert abs(res["variation_percent"] - 0.8144) < 0.01


def test_calculate_price_revision_v2_within_bases(db):
    """Verifica che il calcolo interno alla base 2015 o alla base 2025 non alteri i valori."""
    # Calcolo interno al 2025
    res_2025 = calculate_price_revision(
        db=db,
        contract_type="services",
        amount=100000.0,
        base_period=date(2025, 5, 1),
        comparison_period=date(2025, 10, 1),
        indices_config={
            "type": "single",
            "single_series_id": "ISTAT_NIC_ECOICOP2_00",
        },
    )
    assert res_2025["base_link_applied"] is False
    assert res_2025["base_value"] == 123.0
    assert res_2025["comparison_value"] == 123.2
    assert abs(res_2025["variation_percent"] - 0.1626) < 0.01

    # Calcolo interno al 2026
    res_2026 = calculate_price_revision(
        db=db,
        contract_type="services",
        amount=100000.0,
        base_period=date(2026, 1, 1),
        comparison_period=date(2026, 3, 1),
        indices_config={
            "type": "single",
            "single_series_id": "ISTAT_NIC_ECOICOP2_00",
        },
    )
    assert res_2026["base_link_applied"] is False
    assert res_2026["base_value"] == 100.2
    assert res_2026["comparison_value"] == 101.3
    assert abs(res_2026["variation_percent"] - 1.0978) < 0.01


def test_calculate_weighted_variation_composite(db):
    """Verifica che in un composito (Tabella D) i componenti NIC a cavallo vengano raccordati."""
    components = {
        "ISTAT_NIC_ECOICOP2_00": 50.0,
        "ISTAT_NIC_ECOICOP2_01": 50.0,
    }
    var_w, details, errors = calculate_weighted_variation(
        db,
        components=components,
        base_period=date(2025, 10, 1),
        comparison_period=date(2026, 2, 1),
    )
    assert not errors
    assert var_w is not None
    assert len(details) == 2
    for d in details:
        assert d["base_link_applied"] is True
        assert d["homogenized_comparison_value"] is not None
        assert d["variation_percent"] > 0.0  # Tutte le variazioni raccordate sono positive
    assert 0.0 < var_w < 5.0


def test_calculate_single_v1_crossing_boundary(db):
    """Verifica che anche il servizio v1 applichi il raccordo e dia variazione positiva."""
    res_v1 = calculate_single(
        db=db,
        series_id="ISTAT_NIC_ECOICOP2_00",
        base_period=date(2025, 10, 1),
        comparison_period=date(2026, 2, 1),
        amount=100000.0,
    )
    assert "error" not in res_v1
    assert res_v1["base_link_applied"] is True
    assert 0.0 < res_v1["variation_percent"] < 2.0
