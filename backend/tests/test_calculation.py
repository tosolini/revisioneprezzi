import uuid
from datetime import date

from app.models.index_observation import IndexObservation
from app.models.index_series import IndexSeries
from app.services.calculation_service import calculate_single


def _make_series(db):
    sid = f"TST_{uuid.uuid4().hex[:8]}"
    db.add(IndexSeries(id=sid, name="Test", source="TEST"))
    db.flush()
    return sid


def test_single_index_above_threshold(db):
    sid = _make_series(db)
    db.add(IndexObservation(series_id=sid, ref_period=date(2023, 1, 1), value=100.0, is_definitive=True))
    db.add(IndexObservation(series_id=sid, ref_period=date(2025, 1, 1), value=110.0, is_definitive=True))
    db.commit()

    result = calculate_single(db, sid, date(2023, 1, 1), date(2025, 1, 1), 100000.0, 5.0, 80.0)

    assert result["is_applicable"] is True
    assert result["variation_percent"] == 10.0
    assert result["excess_percent"] == 5.0
    assert result["revision_amount"] == 4000.0


def test_single_index_below_threshold(db):
    sid = _make_series(db)
    db.add(IndexObservation(series_id=sid, ref_period=date(2024, 1, 1), value=100.0, is_definitive=True))
    db.add(IndexObservation(series_id=sid, ref_period=date(2025, 1, 1), value=103.0, is_definitive=True))
    db.commit()

    result = calculate_single(db, sid, date(2024, 1, 1), date(2025, 1, 1), 100000.0, 5.0, 80.0)

    assert result["is_applicable"] is False
    assert result["variation_percent"] == 3.0
    assert result["revision_amount"] == 0.0


def test_missing_data_returns_error(db):
    result = calculate_single(db, "NONEXISTENT", date(2024, 1, 1), date(2025, 1, 1), 100000.0)
    assert "error" in result
