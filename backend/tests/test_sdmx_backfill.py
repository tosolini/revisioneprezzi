"""Test per il servizio sdmx_backfill e l'endpoint di backfill query SDMX."""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.index_import_query import IndexImportQuerySeries
from app.models.index_series import IndexSeries
from app.services.sdmx_backfill import (
    _code_from_series,
    _extract_ateco_code,
    build_sdmx_url,
)


@pytest.fixture
def client():
    return TestClient(app)


def test_build_sdmx_url_wages_ateco_dimensions():
    """Verifica che la chiave SDMX per IR/wages contenga le 6 dimensioni obbligatorie."""
    # 1. Codice a 4 cifre con zeri iniziali (0011)
    s_0011 = IndexSeries(
        id="ISTAT_WAGES_ATECO_0011",
        name="wages_ateco - 0011",
        classification_ref="wages_ateco",
        frequency="monthly",
    )
    url_0011 = build_sdmx_url(s_0011)
    assert url_0011 is not None
    assert "IT1,155_358_DF_DCSC_RETRATECO1_7,1.0" in url_0011
    assert "/M.IT.WAGE_E_2021.N.10.0011/ALL/" in url_0011

    # 2. Codice a 3 cifre (951)
    s_951 = IndexSeries(
        id="ISTAT_WAGES_ATECO_951",
        name="wages_ateco - 951",
        classification_ref="wages_ateco",
        frequency="M",
    )
    url_951 = build_sdmx_url(s_951)
    assert url_951 is not None
    assert "/M.IT.WAGE_E_2021.N.10.951/ALL/" in url_951

    # 3. Sezione ATECO lettera (A)
    s_a = IndexSeries(
        id="ISTAT_WAGES_ATECO_A",
        name="wages_ateco - A",
        classification_ref="wages_ateco",
        frequency="monthly",
    )
    url_a = build_sdmx_url(s_a)
    assert url_a is not None
    assert "/M.IT.WAGE_E_2021.N.10.A/ALL/" in url_a

    # 4. Frequenza annuale
    s_ann = IndexSeries(
        id="ISTAT_WAGES_ATECO_0011",
        name="wages_ateco - 0011",
        classification_ref="wages_ateco",
        frequency="annual",
    )
    url_ann = build_sdmx_url(s_ann)
    assert url_ann is not None
    assert "/A.IT.WAGE_E_2021.N.10.0011/ALL/" in url_ann


def test_build_sdmx_url_unmappable_legacy_wages():
    """Serie legacy non conformi al prefisso ISTAT_WAGES_ATECO non sono mappabili."""
    s = IndexSeries(
        id="ISTAT_RCO_SETT_N",
        name="Retribuzioni noleggio",
        classification_ref="wages_ateco",
        frequency="monthly",
    )
    assert _extract_ateco_code(s) is None
    assert _code_from_series(s) is None
    assert build_sdmx_url(s) is None


def test_build_sdmx_url_other_explorers_unchanged():
    """Verifica che PPI, PPS e PC mantengano il loro formato originale."""
    s_ppi = IndexSeries(
        id="ISTAT_PPI_263",
        name="PPI 263",
        classification_ref="ppi",
        frequency="monthly",
    )
    assert "/M.IT.263/ALL/" in build_sdmx_url(s_ppi)

    s_pps = IndexSeries(
        id="ISTAT_PS_BUSINESS_49",
        name="PPS 49",
        classification_ref="ps_business",
        frequency="quarterly",
    )
    assert "/Q.IT.N.49/ALL/" in build_sdmx_url(s_pps)

    s_pc = IndexSeries(
        id="ISTAT_NIC_ECOICOP2_01111",
        name="PC 01111",
        classification_ref="nic_ecoicop2",
        frequency="monthly",
    )
    assert "/M.IT.85.4.01111/ALL/" in build_sdmx_url(s_pc)


def test_backfill_endpoint_overwrite(client, db):
    """Test dell'endpoint /backfill-queries con parametro overwrite."""
    series_id = "ISTAT_WAGES_ATECO_TEST_BF"
    db.query(IndexImportQuerySeries).filter(
        IndexImportQuerySeries.series_id == series_id
    ).delete(synchronize_session=False)
    db.query(IndexSeries).filter(IndexSeries.id == series_id).delete(synchronize_session=False)
    db.commit()

    test_series = IndexSeries(
        id=series_id,
        name="Test Wages BF",
        source="ISTAT",
        classification_ref="wages_ateco",
        frequency="monthly",
    )
    db.add(test_series)
    db.commit()

    try:
        # Primo backfill senza overwrite
        res = client.post(
            "/api/v1/indices/backfill-queries?classification_ref=wages_ateco"
        )
        assert res.status_code == 200
        data = res.json()
        assert data["backfilled"] >= 1

        # Secondo backfill senza overwrite: la serie ha già la query, quindi non viene ripulita
        res2 = client.post(
            "/api/v1/indices/backfill-queries?classification_ref=wages_ateco"
        )
        assert res2.status_code == 200
        data2 = res2.json()
        # Se non c'è overwrite, non ci sono nuove serie da backfillare
        assert data2["backfilled"] == 0

        # Terzo backfill con overwrite=true: rifà il backfill
        res3 = client.post(
            "/api/v1/indices/backfill-queries?classification_ref=wages_ateco&overwrite=true"
        )
        assert res3.status_code == 200
        data3 = res3.json()
        assert data3["overwrite"] is True
        assert data3["backfilled"] >= 1
    finally:
        # Pulizia
        db.query(IndexImportQuerySeries).filter(
            IndexImportQuerySeries.series_id == series_id
        ).delete(synchronize_session=False)
        db.query(IndexSeries).filter(IndexSeries.id == series_id).delete(synchronize_session=False)
        db.commit()
