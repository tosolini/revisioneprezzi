"""Test per revisione prezzi ricorrente: integrità dati e periodi."""

from datetime import date


from app.models.index_observation import IndexObservation
from app.models.index_series import IndexSeries
from app.services.revision_calculation_v2 import get_strict_index_observation
from app.services.revision_plan_service import generate_comparison_periods


def test_obs_status_lowercase_p_is_not_definitive(db, monkeypatch, tmp_path):
    from app.services import indices_import
    from tests.test_sdmx_import import _point_import_config

    _point_import_config(monkeypatch, tmp_path)

    csv_text = (
        "DATAFLOW,FREQ,REF_AREA,ECON_ACTIVITY_NACE_2007,TIME_PERIOD,OBS_VALUE,OBS_STATUS\n"
        "IT1:145_376_DF_DCSC_PREZPRODSERV_1_7(1.0),Q,IT,49,2024-Q1,111.7,p\n"
    )

    indices_import.import_sdmx_content(csv_text, db, group_key="test_sdmx", freq_param="Q")
    db.commit()

    sid = "ISTAT_TEST_SDMX_49"
    # cleanup not needed; query
    obs = db.query(IndexObservation).filter(
        IndexObservation.series_id == sid, IndexObservation.ref_period == date(2024, 1, 1)
    ).first()
    assert obs is not None
    assert obs.is_definitive is False


def test_strict_lookup_returns_none_when_missing(db):
    import uuid
    sid = f"NONEXISTENT_SERIES_{uuid.uuid4().hex[:8]}"
    db.add(IndexSeries(id=sid, name="x", source="t", normative_category="t", frequency="monthly"))
    db.commit()
    assert get_strict_index_observation(db, sid, date(2024, 1, 1)) is None


def test_generate_comparison_periods_annual():
    periods = generate_comparison_periods(date(2023, 3, 1), "annual", date(2025, 3, 1))
    assert periods == [date(2024, 3, 1), date(2025, 3, 1)]


def test_generate_comparison_periods_monthly_cap():
    periods = generate_comparison_periods(date(2023, 1, 1), "monthly", date(2023, 4, 1))
    assert periods == [date(2023, 2, 1), date(2023, 3, 1), date(2023, 4, 1)]
