from datetime import date

from app.services.sdmx_url_utils import last_month_end, resolve_sdmx_url_dates
from app.services.sdmx_url_utils import _format_like  # internal for testing


def test_last_month_end_jan():
    assert last_month_end(date(2026, 1, 15)) == date(2025, 12, 31)


def test_last_month_end_leap():
    assert last_month_end(date(2024, 3, 1)) == date(2024, 2, 29)


def test_last_month_end_regular():
    assert last_month_end(date(2026, 8, 10)) == date(2026, 7, 31)


def test_format_like_year():
    assert _format_like("2025", date(2026, 7, 31)) == "2026"


def test_format_like_month():
    assert _format_like("2025-06", date(2026, 7, 31)) == "2026-07"


def test_format_like_daily():
    assert _format_like("2025-06-01", date(2026, 7, 31)) == "2026-07-31"


def test_format_like_quarterly():
    # target 2026-07-31 -> 2026-Q2 per plan
    assert _format_like("2025-Q1", date(2026, 7, 31)) == "2026-Q2"
    # target exactly quarter end
    assert _format_like("2025-Q1", date(2026, 6, 30)) == "2026-Q2"
    assert _format_like("2025-Q1", date(2026, 3, 31)) == "2026-Q1"
    assert _format_like("2025-Q1", date(2025, 12, 31)) == "2025-Q4"


def test_resolve_fixed_noop():
    url = "https://esploradati.istat.it/SDMXWS/rest/data/IT1,DF,1.0/M.IT/ALL/?detail=full&startPeriod=2025-06-01&endPeriod=2025-06-30"
    resolved, meta = resolve_sdmx_url_dates(url, "fixed", today=date(2026, 7, 31))
    assert resolved == url
    assert meta == {}


def test_resolve_last_month_end_daily():
    url = "https://esploradati.istat.it/SDMXWS/rest/data/IT1,DF,1.0/M.IT/ALL/?detail=full&startPeriod=2025-06-01&endPeriod=2025-06-30&dimensionAtObservation=TIME_PERIOD"
    resolved, meta = resolve_sdmx_url_dates(url, "last_month_end", today=date(2026, 8, 15))
    # last_month_end of 2026-08-15 is 2026-07-31
    assert "endPeriod=2026-07-31" in resolved
    assert meta["endPeriod"] == "2026-07-31"
    assert meta["original_endPeriod"] == "2025-06-30"


def test_resolve_monthly():
    url = "https://esploradati.istat.it/SDMXWS/rest/data/IT1,DF,1.0/M.IT/ALL/?endPeriod=2025-06&detail=full"
    resolved, meta = resolve_sdmx_url_dates(url, "last_month_end", today=date(2026, 8, 15))
    assert "endPeriod=2026-07" in resolved
    assert meta["endPeriod"] == "2026-07"


def test_resolve_yearly():
    url = "https://esploradati.istat.it/SDMXWS/rest/data/IT1,DF,1.0/M.IT/ALL/?endPeriod=2025&detail=full"
    resolved, meta = resolve_sdmx_url_dates(url, "last_month_end", today=date(2026, 8, 15))
    assert "endPeriod=2026" in resolved


def test_resolve_quarterly():
    url = "https://esploradati.istat.it/SDMXWS/rest/data/IT1,DF,1.0/M.IT/ALL/?endPeriod=2025-Q1&detail=full"
    resolved, meta = resolve_sdmx_url_dates(url, "last_month_end", today=date(2026, 8, 15))
    # 2026-07-31 -> Q2
    assert "endPeriod=2026-Q2" in resolved


def test_resolve_today():
    url = "https://esploradati.istat.it/SDMXWS/rest/data/IT1,DF,1.0/M.IT/ALL/?endPeriod=2025-06-30&detail=full"
    resolved, meta = resolve_sdmx_url_dates(url, "today", today=date(2026, 8, 20))
    assert "endPeriod=2026-08-20" in resolved


def test_resolve_missing_endPeriod_no_add():
    url = "https://esploradati.istat.it/SDMXWS/rest/data/IT1,DF,1.0/M.IT/ALL/?detail=full&startPeriod=2025-06-01"
    resolved, meta = resolve_sdmx_url_dates(url, "last_month_end", today=date(2026, 7, 31))
    assert resolved == url
    assert meta == {}


def test_resolve_no_query():
    url = "https://esploradati.istat.it/SDMXWS/rest/data/IT1,DF,1.0/M.IT/ALL/"
    resolved, meta = resolve_sdmx_url_dates(url, "last_month_end", today=date(2026, 7, 31))
    assert resolved == url


def test_resolve_empty_endPeriod():
    url = "https://esploradati.istat.it/SDMXWS/rest/data/IT1,DF,1.0/M.IT/ALL/?endPeriod=&detail=full"
    resolved, meta = resolve_sdmx_url_dates(url, "last_month_end", today=date(2026, 7, 31))
    assert resolved == url
