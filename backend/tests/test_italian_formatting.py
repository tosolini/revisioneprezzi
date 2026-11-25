"""Test per la formattazione numerica e valutaria italiana nel calcolo e nei report."""

import uuid
from datetime import date

from app.models.case_file import CaseFile
from app.models.contract_context import ContractContext
from app.models.index_observation import IndexObservation
from app.models.index_series import IndexSeries
from app.models.revision_input import RevisionInput
from app.models.revision_result import RevisionResult
from app.services.base_link_service import resolve_base_link
from app.services.calculation_service import calculate_composite, calculate_single
from app.services.report_service import generate_report
from app.services.revision_calculation_v2 import (
    calculate_multi_component_revision,
    calculate_price_revision,
)
from app.utils.format_it import format_it_currency, format_it_number


def _make_series(db, base=100.0, comp=110.0):
    sid = f"ITFMT_{uuid.uuid4().hex[:8]}"
    db.add(IndexSeries(id=sid, name="Serie Test IT", source="TEST"))
    db.add(
        IndexObservation(series_id=sid, ref_period=date(2025, 1, 1), value=base, is_definitive=True)
    )
    db.add(
        IndexObservation(series_id=sid, ref_period=date(2026, 1, 1), value=comp, is_definitive=True)
    )
    db.flush()
    return sid


def test_format_it_helpers():
    assert format_it_number(None) == "—"
    assert format_it_number(0, decimals=2) == "0,00"
    assert format_it_number(-0.0001, decimals=2) == "0,00"
    assert format_it_number(1234.56, decimals=2) == "1.234,56"
    assert format_it_number(100000.0, decimals=2) == "100.000,00"
    assert format_it_number(-1234.5, decimals=2) == "-1.234,50"
    assert format_it_number(3.0, decimals=None, trim_trailing_zeros=True) == "3"
    assert format_it_number(1234.50, decimals=None, trim_trailing_zeros=True) == "1.234,5"
    assert format_it_currency(4000.0) == "€ 4.000,00"
    assert format_it_currency(-4000.0) == "-€ 4.000,00"
    assert format_it_currency(1234567.89) == "€ 1.234.567,89"


def test_v2_single_calculation_uses_italian_format(db):
    sid = _make_series(db, base=100.5, comp=110.55)  # +10%
    db.commit()

    res = calculate_price_revision(
        db=db,
        contract_type="services",
        amount=100000.0,
        base_period=date(2025, 1, 1),
        comparison_period=date(2026, 1, 1),
        indices_config={"type": "single", "single_series_id": sid},
    )

    assert "error" not in res
    assert res["revision_amount"] == 4000.0
    step5 = next(s for s in res["steps"] if s["step"] == 5)
    assert step5["result"] == "€ 4.000,00"
    assert step5["calculation"] == "€ 100.000,00 × (5 / 100) × (80 / 100)"
    assert "€ 4.000,00" in res["summary"]
    assert "100,000.00" not in res["formula_detail"]
    assert "4,000.00" not in res["formula_detail"]
    assert "100,5" in res["formula_detail"]
    assert "110,55" in res["formula_detail"]


def test_v2_weighted_variations_uses_italian_format(db):
    s1 = _make_series(db, base=100.0, comp=110.5)
    s2 = _make_series(db, base=100.0, comp=120.5)
    db.commit()

    res = calculate_price_revision(
        db=db,
        contract_type="services",
        amount=250000.0,
        base_period=date(2025, 1, 1),
        comparison_period=date(2026, 1, 1),
        indices_config={
            "type": "composite",
            "method": "weighted_variations",
            "components": {s1: 40.0, s2: 60.0},
        },
    )

    assert "error" not in res
    step1 = next(s for s in res["steps"] if s["step"] == 1)
    assert "(0,40)×10,5000" in step1["details"]["calculation"]
    assert "(0,60)×20,5000" in step1["details"]["calculation"]
    assert "Vt = 16,5000%" == step1["result"]


def test_v2_multi_component_summary_uses_italian_format(db):
    s1 = _make_series(db, base=100.0, comp=110.0)
    s2 = _make_series(db, base=100.0, comp=115.0)
    db.commit()

    res = calculate_multi_component_revision(
        db=db,
        contract_type="services",
        components=[
            {
                "amount": 100000.0,
                "indices_config": {"type": "single", "single_series_id": s1},
                "description": "Comp 1",
            },
            {
                "amount": 100000.0,
                "indices_config": {"type": "single", "single_series_id": s2},
                "description": "Comp 2",
            },
        ],
        base_period=date(2025, 1, 1),
        comparison_period=date(2026, 1, 1),
    )

    assert "error" not in res
    assert "€ 12.000,00" in res["summary"]
    assert "12,000.00" not in res["summary"]
    assert "6%" in res["summary"]


def test_v1_calculation_uses_italian_format(db):
    sid = _make_series(db, base=100.0, comp=110.0)
    db.commit()

    single = calculate_single(db, sid, date(2025, 1, 1), date(2026, 1, 1), 100000.0, 5.0, 80.0)
    assert single["steps"][-1]["result"] == "€ 4.000,00"
    assert "€ 100.000,00" in single["steps"][-1]["formula"]

    comp = calculate_composite(
        db,
        [{"series_id": sid, "weight": 100.0}],
        date(2025, 1, 1),
        date(2026, 1, 1),
        100000.0,
        5.0,
        80.0,
    )
    assert "€ 4.000,00" in comp["formula_detail"]
    assert "4,000.00" not in comp["formula_detail"]


def test_base_link_note_uses_italian_format(db):
    res = resolve_base_link(
        db,
        series_id="ISTAT_NIC_ECOICOP2_00",
        base_period=date(2025, 10, 1),
        comparison_period=date(2026, 2, 1),
        comp_value=100.7,
    )
    assert res.applied is True
    assert res.note is not None
    assert "100,7 ->" in res.note
    assert "100.7" not in res.note


def test_markdown_report_uses_italian_format(db):
    case = CaseFile(title="Test Report IT")
    db.add(case)
    db.flush()

    db.add(
        ContractContext(
            case_id=case.id,
            contract_type="services",
            contract_amount_total=150000.0,
            amount_subject_to_revision=100000.0,
        )
    )
    db.add(
        RevisionInput(
            case_id=case.id,
            base_period=date(2025, 1, 1),
            comparison_period=date(2026, 1, 1),
            amount_subject_to_revision=100000.0,
            excluded_amount=50000.0,
        )
    )
    db.add(
        RevisionResult(
            case_id=case.id,
            base_value=100.5,
            comparison_value=110.55,
            variation_percent=10.0,
            threshold_percent=5.0,
            excess_percent=5.0,
            recognition_percent=80.0,
            revision_amount=4000.0,
            formula_detail="Passo 5: € 4.000,00",
            result_version=1,
        )
    )
    db.commit()

    md = generate_report(case.id, db)
    assert "150.000,00" in md
    assert "100.000,00" in md
    assert "50.000,00" in md
    assert "10,0000%" in md
    assert "5,0000%" in md
    assert "€ 4.000,00" in md
    assert "150000.00" not in md
    assert "4000.00" not in md
