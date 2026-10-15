"""Serie ISTAT esposte nel report: evidenza usata nel confronto."""

from app.api.v1.report_v2 import _extract_series_evidence, _report_series_labels
from app.models.ateco_catalog import AtecoCatalog
from app.models.index_series import IndexSeries


def test_single_series_from_calc_steps():
    steps = [
        {
            "step": 1,
            "description": "Recupero indici ISTAT",
            "details": {
                "serie": "ISTAT_FOO",
                "periodo_base": "2025-01-01",
                "valore_base": 100.0,
                "periodo_confronto": "2026-01-01",
                "valore_confronto": 110.0,
            },
            "result": "Indice base: 100.0, Indice confronto: 110.0",
        }
    ]
    assert _extract_series_evidence(steps, None, "ISTAT_OTHER") == {"series_id": "ISTAT_FOO"}


def test_composite_components_from_calc_steps():
    components = [
        {
            "series_id": "ISTAT_A",
            "weight": 60.0,
            "base_value": 100.0,
            "comparison_value": 110.0,
            "variation_percent": 10.0,
            "contribution_percent": 6.0,
        }
    ]
    steps = [
        {
            "step": 1,
            "description": "Calcolo media ponderata delle variazioni",
            "details": {"componenti": {"ISTAT_A": 60.0}, "component_details": components,
                        "calculation": "Vt = 6.0000%"},
            "result": "Vt = 6.0%",
        }
    ]
    assert _extract_series_evidence(steps, None, None) == {
        "components": components,
        "calc_math": "Vt = 6.0000%",
    }


def test_multi_component_from_saved_wizard_result():
    saved = {
        "is_multi_component": True,
        "components": [
            {
                "description": "CPV_X",
                "amount": 50000.0,
                "result": {
                    "indices_config": {"type": "single", "single_series_id": "ISTAT_M1"},
                    "steps": [],
                },
            }
        ],
    }
    evidence = _extract_series_evidence([], saved, None)
    assert evidence["multi_components"] == [
        {"description": "CPV_X", "amount": 50000.0, "series_id": "ISTAT_M1"}
    ]


def test_fallback_to_step4_series():
    assert _extract_series_evidence([], None, "ISTAT_STEP4") == {"series_id": "ISTAT_STEP4"}
    assert _extract_series_evidence([], None, None) == {}


def test_report_series_labels_include_ateco(db):
    """Le serie wages_ateco citate nel report hanno etichetta leggibile."""
    db.add(
        IndexSeries(
            id="ISTAT_WAGES_ATECO_ZZ9",
            name="wages_ateco - ZZ9",
            source="TEST",
            classification_ref="wages_ateco",
            frequency="M",
        )
    )
    db.add(AtecoCatalog(ateco_code="ZZ9", description="Attivita di ufficio"))
    db.commit()
    try:
        labels = _report_series_labels(db, ["ISTAT_WAGES_ATECO_ZZ9", "ISTAT_IGNOTA"])
        assert labels["ISTAT_WAGES_ATECO_ZZ9"] == "Attivita di ufficio"
        assert "ISTAT_IGNOTA" not in labels
    finally:
        db.query(IndexSeries).filter(IndexSeries.id == "ISTAT_WAGES_ATECO_ZZ9").delete(
            synchronize_session=False
        )
        db.query(AtecoCatalog).filter(AtecoCatalog.ateco_code == "ZZ9").delete(
            synchronize_session=False
        )
        db.commit()
