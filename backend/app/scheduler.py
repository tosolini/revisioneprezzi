"""Scheduler sidecar per revisione prezzi ricorrente.

Avvio: ``python -m app.scheduler``

Loop giornaliero alle 06:00 Europe/Rome, con catch-up all'avvio. Il fetch
ISTAT resta nel backend; qui si limita a chiamare l'endpoint idempotente.
"""

from __future__ import annotations

import os
import time
from datetime import datetime, timedelta

import httpx
from zoneinfo import ZoneInfo

TZ = ZoneInfo(os.getenv("SCHEDULER_TZ", "Europe/Rome"))
BACKEND_URL = os.getenv("SCHEDULER_BACKEND_URL", "http://backend:8000")
TOKEN = os.getenv("SCHEDULER_TOKEN", "")
RUN_HOUR = int(os.getenv("SCHEDULER_HOUR", "6"))
RUN_MINUTE = int(os.getenv("SCHEDULER_MINUTE", "0"))


def _next_run(now: datetime) -> datetime:
    target = now.replace(hour=RUN_HOUR, minute=RUN_MINUTE, second=0, microsecond=0)
    if target <= now:
        target = target + timedelta(days=1)
    return target


def run_once() -> None:
    url = f"{BACKEND_URL.rstrip('/')}/api/v1/scheduler/run-due"
    headers = {"X-Scheduler-Token": TOKEN}
    try:
        with httpx.Client(timeout=600) as client:
            r = client.post(url, headers=headers)
            print(f"[scheduler] run-due -> {r.status_code} {r.text[:500]}")
    except Exception as e:  # noqa: BLE001
        print(f"[scheduler] error: {e}")


def main() -> None:
    print(
        f"[scheduler] started, tz={TZ}, backend={BACKEND_URL}, "
        f"run at {RUN_HOUR:02d}:{RUN_MINUTE:02d}"
    )
    # catch-up all'avvio
    run_once()
    while True:
        now = datetime.now(TZ)
        nxt = _next_run(now)
        sleep_seconds = (nxt - now).total_seconds()
        print(f"[scheduler] next run at {nxt.isoformat()} (in {int(sleep_seconds)}s)")
        time.sleep(max(1, sleep_seconds))
        run_once()


if __name__ == "__main__":
    main()
