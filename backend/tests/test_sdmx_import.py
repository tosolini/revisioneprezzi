"""Test per importazione query SDMX ISTAT e rate limiter condiviso.

Coprono: validazione URL, fetch con retry 429, rate limit (spacing >= 12s),
parser condiviso (auto-rilevamento dataflow, upsert, provvisorio/definitivo)
e fallback per dataflow non in configurazione.
"""

from datetime import date

import httpx
import pytest
from fastapi import HTTPException

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
CONFIG_MIXED_CSV = (
    "DATAFLOW,FREQ,REF_AREA,DATA_TYPE,ADJUSTMENT,ECON_ACTIVITY_NACE_2007,"
    "PROF_STATUS_EMP,TIME_PERIOD,OBS_VALUE,OBS_STATUS\n"
    "IT1:145_376_DF_DCSC_PREZPRODSERV_1_7(1.0),Q,IT,SERV_PRIC2_2021,N,49,10,"
    "2024-Q1,111.7,\n"
    "IT1:145_376_DF_DCSC_PREZPRODSERV_1_7(1.0),Q,IT,SERV_PRIC2_2021,N,49,23,"
    "2024-Q1,112.0,\n"
)
CSV_DATA_TYPE_FIXTURE = (
    "DATAFLOW,FREQ,REF_AREA,DATA_TYPE,ECON_ACTIVITY_NACE_2007,"
    "TIME_PERIOD,OBS_VALUE,OBS_STATUS\n"
    "IT1:145_376_DF_DCSC_PREZPRODSERV_1_7(1.0),Q,IT,N,49,"
    "2024-Q1,111.7,\n"
    "IT1:145_376_DF_DCSC_PREZPRODSERV_1_7(1.0),Q,IT,R,49,"
    "2024-Q1,112.0,\n"
)


MULTI_FREQ_URL = (
    "https://esploradati.istat.it/SDMXWS/rest/data/"
    "IT1,155_358_DF_DCSC_RETRATECO1_7,1.0/A+M...../ALL/?detail=full"
    "&startPeriod=2025-06-01&endPeriod=2026-06-30&dimensionAtObservation=TIME_PERIOD"
)
MIXED_FREQ_CSV = (
    "DATAFLOW,FREQ,REF_AREA,ECON_ACTIVITY_NACE_2007,TIME_PERIOD,OBS_VALUE,OBS_STATUS\n"
    "IT1:145_376_DF_DCSC_PREZPRODSERV_1_7(1.0),A,IT,49,2025,100.0,\n"
    "IT1:145_376_DF_DCSC_PREZPRODSERV_1_7(1.0),M,IT,49,2025-01,102.0,\n"
)


def _write_test_config(tmp_path) -> str:
    """Config dataflow dedicata ai test: nessuna collisione con dati reali."""
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
    """Fa puntare il parser alla config di test (cache inclusa)."""
    from app.services import indices_import

    monkeypatch.setattr(indices_import, "CONFIG_PATH", _write_test_config(tmp_path))
    monkeypatch.setattr(indices_import, "_DATAFLOW_CONFIG_CACHE", None)


def _cleanup(db, group: str):
    ids = [
        s.id for s in db.query(IndexSeries).filter(IndexSeries.classification_ref == group).all()
    ]
    if ids:
        db.query(IndexObservation).filter(IndexObservation.series_id.in_(ids)).delete(
            synchronize_session=False
        )
        db.query(IndexSeries).filter(IndexSeries.id.in_(ids)).delete(synchronize_session=False)
        db.commit()


def _start_and_poll(client, url: str, timeout: float = 10.0) -> dict:
    """POST (202) + polling del job fino a done/error."""
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


# ── Rate limiter ────────────────────────────────────────────────────────────


def test_rate_limit_slot_spacing(monkeypatch, tmp_path):
    from app.services import sdmx_rate_limit as rl

    monkeypatch.setattr(rl, "_STATE_PATH", tmp_path / ".sdmx_rate_limit.json")
    fake_now = [1_000_000.0]
    monkeypatch.setattr(rl.time, "time", lambda: fake_now[0])
    monkeypatch.setattr(rl.time, "sleep", lambda s: None)
    monkeypatch.setattr(rl.random, "uniform", lambda a, b: 0.5)

    # primo slot libero (nessuno stato precedente)
    assert rl.wait_for_slot(max_wait=0) == 0.0

    fake_now[0] += 5.0  # 5s dopo: servono altri ~7.5s
    with pytest.raises(rl.RateLimitTimeout):
        rl.wait_for_slot(max_wait=0)
    waited = rl.wait_for_slot(max_wait=60)
    assert waited >= 12.0 - 5.0


def test_rate_limit_state_persisted(monkeypatch, tmp_path):
    from app.services import sdmx_rate_limit as rl

    state = tmp_path / "state.json"
    monkeypatch.setattr(rl, "_STATE_PATH", state)
    monkeypatch.setattr(rl.time, "sleep", lambda s: None)

    rl.wait_for_slot(max_wait=0)
    import json

    assert json.loads(state.read_text())["last_request"] > 0


def test_import_sdmx_wait_failure_reported_in_job(client, monkeypatch):
    """Slot di rate limit non disponibile: il job termina in errore con il
    messaggio dell'attesa (l'operazione è asincrona)."""
    from app.api.v1 import indices
    from app.services.sdmx_rate_limit import RateLimitTimeout

    def busy(max_wait: float = 45.0):
        raise RateLimitTimeout(20.0)

    monkeypatch.setattr(indices, "wait_for_slot", busy)
    job = _start_and_poll(client, SDMX_DATA_URL)
    assert job["status"] == "error"
    assert "5 query/minuto" in job["error"]


# ── Fetch con retry 429 ─────────────────────────────────────────────────────


def _patch_httpx_client(monkeypatch, handler):
    transport = httpx.MockTransport(handler)

    class _Client(httpx.Client):
        def __init__(self, **kwargs):
            kwargs.setdefault("transport", transport)
            super().__init__(**kwargs)

    monkeypatch.setattr(httpx, "Client", _Client)


def _freeze_rate_limiter(monkeypatch, tmp_path):
    from app.services import sdmx_rate_limit as rl

    monkeypatch.setattr(rl, "_STATE_PATH", tmp_path / ".sdmx_rate_limit.json")
    monkeypatch.setattr(rl.time, "sleep", lambda s: None)


def test_fetch_sdmx_retries_once_on_429(monkeypatch, tmp_path):
    from app.api.v1 import indices

    _freeze_rate_limiter(monkeypatch, tmp_path)
    calls: list[str] = []

    def handler(request):
        calls.append(str(request.url))
        if len(calls) == 1:
            return httpx.Response(429, headers={"Retry-After": "1"}, text="")
        return httpx.Response(200, text=CSV_FIXTURE)

    _patch_httpx_client(monkeypatch, handler)
    content = indices._fetch_sdmx_csv(SDMX_DATA_URL)
    assert content == CSV_FIXTURE
    assert len(calls) == 2


def test_fetch_sdmx_ban_on_repeated_429(monkeypatch, tmp_path):
    from app.api.v1 import indices

    _freeze_rate_limiter(monkeypatch, tmp_path)

    def handler(request):
        # Retry-After di 2 ore: segnale di ban, niente retry "dormiente"
        return httpx.Response(429, headers={"Retry-After": "7200"}, text="")

    _patch_httpx_client(monkeypatch, handler)
    with pytest.raises(HTTPException) as exc:
        indices._fetch_sdmx_csv(SDMX_DATA_URL)
    assert exc.value.status_code == 429
    assert "blocco" in exc.value.detail


def test_fetch_sdmx_404_raises_no_records(monkeypatch, tmp_path):
    from app.api.v1 import indices

    _freeze_rate_limiter(monkeypatch, tmp_path)

    def handler(request):
        return httpx.Response(404, text="NoRecordsFound")

    _patch_httpx_client(monkeypatch, handler)
    with pytest.raises(indices.SdmxNoRecordsError):
        indices._fetch_sdmx_csv(SDMX_DATA_URL)


def test_fetch_sdmx_upstream_422_clear_message(monkeypatch, tmp_path):
    from app.api.v1 import indices

    _freeze_rate_limiter(monkeypatch, tmp_path)

    def handler(request):
        return httpx.Response(422, text="Not enough key values in query")

    _patch_httpx_client(monkeypatch, handler)
    with pytest.raises(HTTPException) as exc:
        indices._fetch_sdmx_csv(SDMX_DATA_URL)
    assert exc.value.status_code == 422
    assert "dimensio" in exc.value.detail


def test_fetch_sdmx_deadline_504(monkeypatch, tmp_path):
    from app.api.v1 import indices

    _freeze_rate_limiter(monkeypatch, tmp_path)
    monkeypatch.setattr(indices, "SDMX_FETCH_TOTAL_BUDGET", 0.0)

    def handler(request):
        pytest.fail("con budget esaurito non deve partire nessuna richiesta")

    _patch_httpx_client(monkeypatch, handler)
    with pytest.raises(HTTPException) as exc:
        indices._fetch_sdmx_csv(SDMX_DATA_URL)
    assert exc.value.status_code == 504


def test_fetch_sdmx_read_timeout_504(monkeypatch, tmp_path):
    from app.api.v1 import indices

    _freeze_rate_limiter(monkeypatch, tmp_path)

    def handler(request):
        raise httpx.ReadTimeout("server muto", request=request)

    _patch_httpx_client(monkeypatch, handler)
    with pytest.raises(HTTPException) as exc:
        indices._fetch_sdmx_csv(SDMX_DATA_URL)
    assert exc.value.status_code == 504


# ── Validazione URL endpoint ────────────────────────────────────────────────


@pytest.mark.parametrize(
    "url",
    [
        "http://esploradati.istat.it/SDMXWS/rest/data/IT1,145_376_DF_DCSC_PREZPRODSERV_1_7,1.0/Q..../ALL/",
        "https://evil.example.com/SDMXWS/rest/data/IT1,145_376_DF_DCSC_PREZPRODSERV_1_7,1.0/Q..../ALL/",
        "https://esploradati.istat.it/SDMXWS/rest/structure/dataflow/IT1/145_376_DF_DCSC_PREZPRODSERV_1_7/1.0/",
        "https://esploradati.istat.it/SDMXWS/rest/data/IT1,X,1.0/Q..../ALL/",
        "notaurl",
    ],
)
def test_import_sdmx_rejects_bad_urls(client, url):
    resp = client.post("/api/v1/indices/import-sdmx", json={"url": url})
    assert resp.status_code == 422


def test_import_sdmx_requires_url(client):
    resp = client.post("/api/v1/indices/import-sdmx", json={})
    assert resp.status_code == 422


def test_import_sdmx_multi_frequency_imports_as_is(client, db, monkeypatch, tmp_path):
    """FREQ=A+M richiesta esplicitamente: l'import la esegue in background com'è
    (l'asincronicità assorbe i 5-6 minuti di Istat). Se i dati fossero davvero
    mescolati annuale+mensile, il parser rifiuterebbe (collisione periodi)."""
    from app.api.v1 import indices

    _point_import_config(monkeypatch, tmp_path)
    called: list[str] = []

    def fake_fetch(url: str, attempts: int = 2, budget: float | None = None) -> str:
        called.append(url)
        return CSV_FIXTURE

    monkeypatch.setattr(indices, "_fetch_sdmx_csv", fake_fetch)
    job = _start_and_poll(client, MULTI_FREQ_URL)
    assert job["status"] == "done"
    data = job["result"]
    assert data["details"]["added"] == 3
    assert data["details"].get("frequency_adjusted") is None
    assert "format=csv" in data["url"]
    assert "/A+M....." in data["url"]
    assert len(called) == 1  # la query richiesta, una volta sola
    try:
        assert (
            db.query(IndexSeries).filter(IndexSeries.id == "ISTAT_TEST_SDMX_49").first() is not None
        )
    finally:
        _cleanup(db, "test_sdmx")


def test_import_sdmx_rejects_unfiltered_dimensions(client, db, monkeypatch, tmp_path):
    """Dimensione extra variabile (es. PROF_STATUS_EMP) mescolerebbe popolazioni
    nella stessa serie: import rifiutato con messaggio che la nomina."""
    import json

    from app.api.v1 import indices

    _point_import_config(monkeypatch, tmp_path)

    def fake_fetch(url: str) -> str:
        return CONFIG_MIXED_CSV

    monkeypatch.setattr(indices, "_fetch_sdmx_csv", fake_fetch)
    job = _start_and_poll(client, SDMX_DATA_URL)
    assert job["status"] == "error"
    assert "PROF_STATUS_EMP" in job["error"]
    # Verifica payload strutturato: unfiltered_dimensions contiene valori distinti
    err_text = job["error"]
    try:
        payload = json.loads(err_text)
        assert isinstance(payload, dict)
        assert "unfiltered_dimensions" in payload
        assert "PROF_STATUS_EMP" in payload["unfiltered_dimensions"]
        vals = payload["unfiltered_dimensions"]["PROF_STATUS_EMP"]
        assert sorted(vals) == ["10", "23"]
        assert "message" in payload
    except json.JSONDecodeError:
        pytest.fail(f"job error non è JSON strutturato: {err_text}")


def test_import_sdmx_404_autofix_single_frequency(client, db, monkeypatch, tmp_path):
    """FREQ senza dati: solo una alternativa risponde, l'import corregge da solo
    (Q→M) e lo segnala nei dettagli."""
    from app.api.v1 import indices

    _point_import_config(monkeypatch, tmp_path)

    def fake_fetch(url: str, attempts: int = 2, budget: float | None = None) -> str:
        if "/M...." in url:
            return CSV_FIXTURE
        raise indices.SdmxNoRecordsError()

    monkeypatch.setattr(indices, "_fetch_sdmx_csv", fake_fetch)
    job = _start_and_poll(client, SDMX_DATA_URL)
    assert job["status"] == "done"
    data = job["result"]
    assert data["details"]["added"] == 3
    assert data["details"]["frequency_adjusted"] == "Q→M"
    assert "/M...." in data["url"]
    try:
        assert (
            db.query(IndexSeries).filter(IndexSeries.id == "ISTAT_TEST_SDMX_49").first() is not None
        )
    finally:
        _cleanup(db, "test_sdmx")


def test_import_sdmx_404_multiple_frequencies_no_guess(client, monkeypatch, tmp_path):
    """Più frequenze alternative disponibili: niente auto-guessing, messaggio
    con le opzioni e URL riscritte."""
    from app.api.v1 import indices

    def fake_fetch(url: str, attempts: int = 2, budget: float | None = None) -> str:
        if "/M...." in url or "/A...." in url:
            return CSV_FIXTURE
        raise indices.SdmxNoRecordsError()

    monkeypatch.setattr(indices, "_fetch_sdmx_csv", fake_fetch)
    job = _start_and_poll(client, SDMX_DATA_URL)
    assert job["status"] == "error"
    detail = job["error"]
    assert "Frequenze disponibili" in detail
    assert "mensile" in detail
    assert "annuale" in detail


def test_import_sdmx_404_no_frequency_available(client, monkeypatch, tmp_path):
    from app.api.v1 import indices

    def fake_fetch(url: str, attempts: int = 2, budget: float | None = None) -> str:
        raise indices.SdmxNoRecordsError()

    monkeypatch.setattr(indices, "_fetch_sdmx_csv", fake_fetch)
    job = _start_and_poll(client, SDMX_DATA_URL)
    assert job["status"] == "error"
    assert "Nessun dato" in job["error"]


def test_probe_treats_timeout_as_no_data(client, monkeypatch):
    """Una frequenza che appende il server non deve bloccare la scoperta:
    il timeout della probe conta come 'nessun dato'."""
    from fastapi import HTTPException as FastHTTPException
    from app.api.v1 import indices

    calls: list[str] = []

    def fake_fetch(url: str, attempts: int = 2, budget: float | None = None) -> str:
        calls.append(url)
        if "lastNObservations" in url:
            raise FastHTTPException(504, "Timeout simulato")
        raise indices.SdmxNoRecordsError()

    monkeypatch.setattr(indices, "_fetch_sdmx_csv", fake_fetch)
    # Frequenza originale Q senza dati, entrambe le probe in timeout -> error
    job = _start_and_poll(client, SDMX_DATA_URL)
    assert job["status"] == "error"
    assert "non verificabile" in job["error"]
    assert "Suggerimento" in job["error"]
    assert len(calls) == 3  # query originale + due probe, nessuna auto-fix


# ── Flusso completo endpoint + parser ───────────────────────────────────────


def test_import_sdmx_endpoint_flow(client, db, monkeypatch, tmp_path):
    from app.api.v1 import indices

    _point_import_config(monkeypatch, tmp_path)
    captured: dict[str, str] = {}

    def fake_fetch(url: str) -> str:
        captured["url"] = url
        return CSV_FIXTURE

    monkeypatch.setattr(indices, "_fetch_sdmx_csv", fake_fetch)

    job = _start_and_poll(client, SDMX_DATA_URL)
    assert job["status"] == "done"
    data = job["result"]
    assert data["dataflow_id"] == "145_376_DF_DCSC_PREZPRODSERV_1_7"
    assert data["details"]["dataflow_matched"] is True
    assert data["details"]["group_key"] == "test_sdmx"
    assert data["details"]["frequency"] == "quarterly"
    assert data["details"]["added"] == 3
    assert data["details"]["series_created"] == 2

    # URL normalizzato: format=csv e dimensione osservazione forzata
    assert "format=csv" in captured["url"]
    assert "dimensionAtObservation=TIME_PERIOD" in captured["url"]

    try:
        s49 = db.query(IndexSeries).filter(IndexSeries.id == "ISTAT_TEST_SDMX_49").first()
        assert s49 is not None
        assert s49.name == "Serie test 49"
        assert s49.frequency == "quarterly"
        obs = {
            o.ref_period: o
            for o in db.query(IndexObservation)
            .filter(IndexObservation.series_id == "ISTAT_TEST_SDMX_49")
            .all()
        }
        assert obs[date(2024, 1, 1)].value == 111.7
        assert obs[date(2024, 1, 1)].is_definitive is True
        assert obs[date(2024, 4, 1)].value == 112.6
        assert obs[date(2024, 4, 1)].is_definitive is False  # OBS_STATUS=P

        # secondo import: upsert, niente duplicati
        job2 = _start_and_poll(client, SDMX_DATA_URL)
        assert job2["status"] == "done"
        d2 = job2["result"]["details"]
        assert d2["added"] == 0
        assert d2["updated"] == 3
        assert d2["series_created"] == 0

        count = (
            db.query(IndexObservation)
            .filter(IndexObservation.series_id == "ISTAT_TEST_SDMX_49")
            .count()
        )
        assert count == 2
    finally:
        _cleanup(db, "test_sdmx")


def test_import_sdmx_content_rejects_mixed_frequencies(db, monkeypatch, tmp_path):
    """Query A+M che restituisce davvero dati annuali E mensili: i periodi
    (2025 vs 2025-01) collidono sulla stessa serie -> rifiuto prima di scrivere."""
    from app.services.indices_import import import_sdmx_content

    _point_import_config(monkeypatch, tmp_path)
    with pytest.raises(HTTPException) as exc:
        import_sdmx_content(MIXED_FREQ_CSV, db, group_key="test_sdmx", freq_param="quarterly")
    assert exc.value.status_code == 422
    assert "frequenze" in exc.value.detail


def test_import_sdmx_content_rejects_data_type_with_details(db, monkeypatch, tmp_path):
    """CSV con DATA_TYPE non filtrata (N vs R) deve fallire con detail strutturato
    contenente unfiltered_dimensions. Verifica il caso 155_358 (retribuzioni ATECO)."""
    from app.services.indices_import import import_sdmx_content

    _point_import_config(monkeypatch, tmp_path)
    with pytest.raises(HTTPException) as exc:
        import_sdmx_content(CSV_DATA_TYPE_FIXTURE, db)
    assert exc.value.status_code == 422
    detail = exc.value.detail
    assert isinstance(detail, dict), f"detail non è dict: {detail}"
    assert "unfiltered_dimensions" in detail
    assert "DATA_TYPE" in detail["unfiltered_dimensions"]
    assert sorted(detail["unfiltered_dimensions"]["DATA_TYPE"]) == ["N", "R"]
    assert "message" in detail
    assert "DATA_TYPE" in detail["message"]


def test_import_sdmx_content_unknown_dataflow(db, monkeypatch, tmp_path):
    from app.services.indices_import import import_sdmx_content

    _point_import_config(monkeypatch, tmp_path)  # dataflow 999_998_FAKE_DF_1 assente
    try:
        details = import_sdmx_content(
            UNKNOWN_CSV, db, group_key="test_unknown", freq_param="quarterly"
        )
        assert details["dataflow_matched"] is False
        assert details["dataflow_id"] == "999_998_FAKE_DF_1"
        assert details["added"] == 2
        assert details["series_created"] == 2

        s = db.query(IndexSeries).filter(IndexSeries.id == "ISTAT_TEST_UNKNOWN_AAA").first()
        assert s is not None
        # FREQ=Q della colonna vince sul fallback
        assert s.frequency == "quarterly"
        obs = (
            db.query(IndexObservation)
            .filter(IndexObservation.series_id == "ISTAT_TEST_UNKNOWN_AAA")
            .first()
        )
        assert obs.value == 100.0
        assert obs.is_definitive is True
    finally:
        _cleanup(db, "test_unknown")


def test_import_csv_route_uses_shared_parser(client, db, monkeypatch, tmp_path):
    """La route import-csv mantiene il contratto e usa il parser condiviso."""
    from app.services.indices_import import import_sdmx_content

    _point_import_config(monkeypatch, tmp_path)
    import io

    orig = import_sdmx_content

    def spy(content, session, group_key="", freq_param=""):
        assert isinstance(content, str)
        return orig(content, session, group_key=group_key, freq_param=freq_param)

    monkeypatch.setattr("app.api.v1.indices.import_sdmx_content", spy)
    try:
        resp = client.post(
            "/api/v1/indices/import-csv?group_key=test_csv&freq_param=quarterly",
            files={"file": ("test.csv", io.BytesIO(UNKNOWN_CSV.encode("utf-8")), "text/csv")},
        )
        assert resp.status_code == 200
        d = resp.json()["details"]
        assert d["added"] == 2
        assert d["series_created"] == 2
        assert resp.json()["message"] == "Importazione completata"
    finally:
        _cleanup(db, "test_csv")


# ── Svuotamento indice ──────────────────────────────────────────────────────


def test_clear_series_observations(client, db):
    """Svuota un indice: osservazioni eliminate, serie conservata, audit."""
    import uuid as _uuid
    from app.models.audit_log import AuditLog

    sid = f"TST_CLEAR_{_uuid.uuid4().hex[:6]}"
    db.add(IndexSeries(id=sid, name="Svuota Test", source="TEST", classification_ref="test_clear"))
    db.add(
        IndexObservation(
            series_id=sid, ref_period=date(2024, 1, 1), value=100.0, is_definitive=True
        )
    )
    db.add(
        IndexObservation(
            series_id=sid, ref_period=date(2024, 4, 1), value=101.0, is_definitive=True
        )
    )
    db.commit()
    try:
        resp = client.delete(f"/api/v1/indices/{sid}/observations")
        assert resp.status_code == 200
        assert resp.json()["deleted"] == 2

        # serie conservata, osservazioni sparite
        assert db.query(IndexSeries).filter(IndexSeries.id == sid).first() is not None
        assert db.query(IndexObservation).filter(IndexObservation.series_id == sid).count() == 0

        # secondo svuotamento: 0 eliminate
        resp2 = client.delete(f"/api/v1/indices/{sid}/observations")
        assert resp2.status_code == 200
        assert resp2.json()["deleted"] == 0

        # operazione tracciata nell'audit
        audit = db.query(AuditLog).filter(AuditLog.event_type == "indices.clear_series").all()
        assert len(audit) >= 1
        assert audit[-1].payload_json is not None
    finally:
        db.query(IndexObservation).filter(IndexObservation.series_id == sid).delete(
            synchronize_session=False
        )
        db.query(IndexSeries).filter(IndexSeries.id == sid).delete(synchronize_session=False)
        db.commit()


def test_clear_series_not_found(client):
    resp = client.delete("/api/v1/indices/ISTAT_NON_ESISTENTE_999/observations")
    assert resp.status_code == 404
