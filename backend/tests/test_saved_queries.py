"""Test per il salvataggio automatico delle query SDMX e il CRUD.

Coprono: auto-salvataggio dopo import SDMX (con link alle serie), nessun
salvataggio per import CSV, re-run della query salvata, aggiornamento URL,
eliminazione con audit e 404 su id inesistenti.
"""

import uuid

from app.models.audit_log import AuditLog
from app.models.index_import_query import IndexImportQuery, IndexImportQuerySeries
from app.models.index_observation import IndexObservation
from app.models.index_series import IndexSeries

SDMX_DATA_URL = (
    "https://esploradati.istat.it/SDMXWS/rest/data/"
    "IT1,145_376_DF_DCSC_PREZPRODSERV_1_7,1.0/Q..../ALL/?detail=full"
    "&startPeriod=2024-01-01&endPeriod=2025-03-31&dimensionAtObservation=TIME_PERIOD"
)

CSV_FIXTURE = (
    "DATAFLOW,FREQ,REF_AREA,DATA_TYPE,ADJUSTMENT,ECON_ACTIVITY_NACE_2007,"
    "TIME_PERIOD,OBS_VALUE,OBS_STATUS\n"
    "IT1:145_376_DF_DCSC_PREZPRODSERV_1_7(1.0),Q,IT,SERV_PRIC2_2021,N,49,"
    "2024-Q1,111.7,\n"
    "IT1:145_376_DF_DCSC_PREZPRODSERV_1_7(1.0),Q,IT,SERV_PRIC2_2021,N,49,"
    "2024-Q2,112.6,P\n"
    "IT1:145_376_DF_DCSC_PREZPRODSERV_1_7(1.0),Q,IT,SERV_PRIC2_2021,N,50,"
    "2024-Q1,112,\n"
)

UNKNOWN_CSV = (
    "DATAFLOW,FREQ,REF_AREA,MY_DIM,TIME_PERIOD,OBS_VALUE,OBS_STATUS\n"
    "IT1:999_998_FAKE_DF_1(1.0),Q,IT,AAA,2024-Q1,100.0,\n"
    "IT1:999_998_FAKE_DF_1(1.0),Q,IT,BBB,2024-Q1,101.0,A\n"
)


def _write_test_config(tmp_path) -> str:
    cfg = tmp_path / "dataflow_test.yaml"
    cfg.write_text(
        """dataflows:
  - dataflow_id: "145_376_DF_DCSC_PREZPRODSERV_1_7"
    description: "Test BtoB"
    contract_type: "services"
    frequency: "quarterly"
    group_key: "test_sdmx"
    dimension_map:
      series_code: "ECON_ACTIVITY_NACE_2007"
      value: "OBS_VALUE"
      period: "TIME_PERIOD"
    series:
      - code: "49"
        name: "Serie test 49"
""",
        encoding="utf-8",
    )
    return str(cfg)


def _point_import_config(monkeypatch, tmp_path):
    from app.services import indices_import

    monkeypatch.setattr(indices_import, "CONFIG_PATH", _write_test_config(tmp_path))
    monkeypatch.setattr(indices_import, "_DATAFLOW_CONFIG_CACHE", None)


def _cleanup(db, group: str):
    ids = [
        s.id
        for s in db.query(IndexSeries).filter(IndexSeries.classification_ref == group).all()
    ]
    if ids:
        db.query(IndexImportQuerySeries).filter(
            IndexImportQuerySeries.series_id.in_(ids)
        ).delete(synchronize_session=False)
        db.query(IndexObservation).filter(
            IndexObservation.series_id.in_(ids)
        ).delete(synchronize_session=False)
        db.query(IndexSeries).filter(IndexSeries.id.in_(ids)).delete(
            synchronize_session=False
        )
        db.commit()


def _fetch_mock(url: str, captured: dict) -> str:
    captured["url"] = url
    return CSV_FIXTURE


def _start_and_poll(client, url: str, timeout: float = 10.0) -> dict:
    """POST /import-sdmx (202) + polling del job fino a done/error."""
    import time

    resp = client.post("/api/v1/indices/import-sdmx", json={"url": url})
    assert resp.status_code == 202, resp.text
    job_id = resp.json()["job_id"]
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = client.get(f"/api/v1/indices/import-jobs/{job_id}").json()
        if job["status"] in ("done", "error"):
            return job
        time.sleep(0.05)
    last = client.get(f"/api/v1/indices/import-jobs/{job_id}").json()
    raise AssertionError(f"job {job_id} non concluso: {last}")


def _poll_run(client, query_id: str, timeout: float = 10.0) -> dict:
    """POST /saved-queries/{id}/run (202) + polling del job."""
    import time

    resp = client.post(f"/api/v1/indices/saved-queries/{query_id}/run")
    assert resp.status_code == 202, resp.text
    job_id = resp.json()["job_id"]
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = client.get(f"/api/v1/indices/import-jobs/{job_id}").json()
        if job["status"] in ("done", "error"):
            return job
        time.sleep(0.05)
    last = client.get(f"/api/v1/indices/import-jobs/{job_id}").json()
    raise AssertionError(f"job {job_id} non concluso: {last}")


def _seed_query(db, url: str, series_ids: list[str] | None = None) -> IndexImportQuery:
    from app.api.v1 import indices

    _, dataflow_id, key_part = indices._validate_sdmx_url(url)
    q = IndexImportQuery(
        id=uuid.uuid4(),
        url=url,
        dataflow_id=dataflow_id,
        key_part=key_part,
    )
    db.add(q)
    db.flush()
    for sid in series_ids or []:
        db.add(IndexImportQuerySeries(query_id=q.id, series_id=sid))
    db.commit()
    return q


# ── Auto-salvataggio dopo import SDMX ───────────────────────────────────────


def test_import_sdmx_saves_query_and_links_series(client, db, monkeypatch, tmp_path):
    from app.api.v1 import indices

    _point_import_config(monkeypatch, tmp_path)
    captured: dict[str, str] = {}
    monkeypatch.setattr(indices, "_fetch_sdmx_csv", lambda url: _fetch_mock(url, captured))

    job = _start_and_poll(client, SDMX_DATA_URL)
    assert job["status"] == "done", job.get("error")
    details = job["result"]["details"]
    assert details["series_ids"] == ["ISTAT_TEST_SDMX_49", "ISTAT_TEST_SDMX_50"]

    try:
        normalized, dataflow_id, key_part = indices._validate_sdmx_url(SDMX_DATA_URL)
        q = db.query(IndexImportQuery).filter(IndexImportQuery.url == normalized).first()
        assert q is not None
        assert q.dataflow_id == dataflow_id
        assert q.key_part == key_part
        assert q.last_run_at is not None

        linked = {
            link.series_id
            for link in db.query(IndexImportQuerySeries)
            .filter(IndexImportQuerySeries.query_id == q.id)
            .all()
        }
        assert linked == set(details["series_ids"])

        # by-group espone saved_query sulle serie toccate
        resp = client.get("/api/v1/indices/by-group/test_sdmx")
        assert resp.status_code == 200
        by_id = {s["id"]: s for s in resp.json()}
        for sid in details["series_ids"]:
            assert by_id[sid]["saved_query"]["id"] == str(q.id)
            assert by_id[sid]["saved_query"]["dataflow_id"] == dataflow_id
    finally:
        _cleanup(db, "test_sdmx")
        db.query(IndexImportQuery).delete(synchronize_session=False)
        db.commit()


def test_import_csv_does_not_save_query(client, db, monkeypatch, tmp_path):
    _point_import_config(monkeypatch, tmp_path)
    import io

    resp = client.post(
        "/api/v1/indices/import-csv?group_key=test_csv&freq_param=quarterly",
        files={"file": ("test.csv", io.BytesIO(UNKNOWN_CSV.encode("utf-8")), "text/csv")},
    )
    assert resp.status_code == 200
    assert resp.json()["details"]["added"] == 2
    try:
        assert db.query(IndexImportQuery).count() == 0
    finally:
        _cleanup(db, "test_csv")


# ── CRUD query salvata ──────────────────────────────────────────────────────


def test_saved_query_run_reenrols(client, db, monkeypatch, tmp_path):
    from app.api.v1 import indices

    _point_import_config(monkeypatch, tmp_path)
    monkeypatch.setattr(indices, "_fetch_sdmx_csv", lambda url: CSV_FIXTURE)

    job = _start_and_poll(client, SDMX_DATA_URL)
    assert job["status"] == "done", job.get("error")
    try:
        normalized, _, _ = indices._validate_sdmx_url(SDMX_DATA_URL)
        q = db.query(IndexImportQuery).filter(IndexImportQuery.url == normalized).first()
        assert q is not None
        qid = str(q.id)
        first_run = q.last_run_at

        job2 = _poll_run(client, qid)
        assert job2["status"] == "done", job2.get("error")
        assert job2["result"]["details"]["updated"] == 3

        db.expire_all()
        q2 = db.query(IndexImportQuery).filter(IndexImportQuery.id == q.id).first()
        assert q2 is not None
        assert q2.last_run_at is not None and q2.last_run_at >= first_run

        # serie ancora linkata alla stessa query
        links = db.query(IndexImportQuerySeries).filter(
            IndexImportQuerySeries.query_id == q.id
        ).all()
        assert {link.series_id for link in links} == {"ISTAT_TEST_SDMX_49", "ISTAT_TEST_SDMX_50"}
    finally:
        _cleanup(db, "test_sdmx")
        db.query(IndexImportQuery).delete(synchronize_session=False)
        db.commit()


def test_saved_query_update(client, db):
    q = _seed_query(db, SDMX_DATA_URL)
    try:
        new_url = (
            "https://esploradati.istat.it/SDMXWS/rest/data/"
            "IT1,145_376_DF_DCSC_PREZPRODSERV_1_7,1.0/A...../ALL/?detail=full"
            "&startPeriod=2025-01-01&endPeriod=2026-06-30"
        )
        resp = client.put(f"/api/v1/indices/saved-queries/{q.id}", json={"url": new_url})
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == str(q.id)
        assert "2025-01-01" in body["url"]
        assert body["dataflow_id"] == "145_376_DF_DCSC_PREZPRODSERV_1_7"
        assert "format=csv" in body["url"]

        bad = client.put(
            f"/api/v1/indices/saved-queries/{q.id}",
            json={"url": "https://esempio.it/SDMXWS/rest/data/x/y/"},
        )
        assert bad.status_code == 422
    finally:
        db.query(IndexImportQuery).filter(IndexImportQuery.id == q.id).delete(
            synchronize_session=False
        )
        db.commit()


def test_saved_query_delete(client, db):
    sid = f"SQ_DEL_{uuid.uuid4().hex[:6]}"
    db.add(IndexSeries(
        id=sid, name="Serie query delete", source="TEST", classification_ref="test_sqdel"
    ))
    db.commit()
    q = _seed_query(db, SDMX_DATA_URL, series_ids=[sid])
    try:
        resp = client.delete(f"/api/v1/indices/saved-queries/{q.id}")
        assert resp.status_code == 200
        assert resp.json() == {"deleted": True, "query_id": str(q.id)}

        # riga e link rimossi, serie conservata
        assert db.query(IndexImportQuery).filter(IndexImportQuery.id == q.id).first() is None
        assert db.query(IndexImportQuerySeries).filter(
            IndexImportQuerySeries.query_id == q.id
        ).count() == 0
        assert db.query(IndexSeries).filter(IndexSeries.id == sid).first() is not None

        # by-group non espone più la query
        g = client.get("/api/v1/indices/by-group/test_sqdel").json()
        assert g[0]["saved_query"] is None

        # evento audit
        audit = db.query(AuditLog).filter(
            AuditLog.event_type == "indices.delete_import_query"
        ).all()
        assert len(audit) >= 1
        assert audit[-1].payload_json is not None
    finally:
        db.query(IndexImportQuerySeries).filter(
            IndexImportQuerySeries.series_id == sid
        ).delete(synchronize_session=False)
        db.query(IndexSeries).filter(IndexSeries.id == sid).delete(
            synchronize_session=False
        )
        db.commit()


def test_saved_query_404(client, db):
    missing = str(uuid.uuid4())
    assert client.get(f"/api/v1/indices/saved-queries/{missing}").status_code == 404
    assert client.put(
        f"/api/v1/indices/saved-queries/{missing}", json={"url": SDMX_DATA_URL}
    ).status_code == 404
    assert client.delete(f"/api/v1/indices/saved-queries/{missing}").status_code == 404
    # id malformato: 404, non 500
    assert client.get("/api/v1/indices/saved-queries/non-un-uuid").status_code == 404