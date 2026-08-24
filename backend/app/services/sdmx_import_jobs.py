"""Esecuzione asincrona degli import SDMX.

Istat può impiegare anche 5-10 minuti per rispondere alle query con chiavi
tutti-wildcard: una richiesta HTTP sincrona resterebbe appesa (e il proxy nginx
del frontend taglia a 60s). L'import gira in un thread di background e la UI fa
polling sullo stato. Store in-memory: adatto a un backend a worker singolo;
un riavvio del processo perde i job in corso (l'utente li rivede)."""

import threading
import time
import uuid
from datetime import datetime, timezone

_JOB_TTL_SECONDS = 3600

_jobs: dict[str, dict] = {}
_lock = threading.Lock()


def submit(runner, url: str | None = None) -> dict:
    """Avvia runner() in un thread e ritorna il job (status running)."""
    with _lock:
        _purge_locked()
        job = {
            "id": uuid.uuid4().hex,
            "status": "ready",
            "url": url,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "result": None,
            "error": None,
        }
        _jobs[job["id"]] = job
    threading.Thread(target=_run, args=(job["id"], runner), daemon=True).start()
    return job


def get(job_id: str) -> dict | None:
    with _lock:
        job = _jobs.get(job_id)
        return dict(job) if job else None


def _run(job_id: str, runner) -> None:
    with _lock:
        if _jobs.get(job_id) is None:
            return
        _jobs[job_id]["status"] = "running"
    try:
        result = runner()
    except Exception as e:  # l'errore è già un messaggio per l'utente
        with _lock:
            job = _jobs.get(job_id)
            if job is not None:
                job["status"] = "error"
                job["error"] = str(e)
        return
    with _lock:
        job = _jobs.get(job_id)
        if job is not None:
            job["status"] = "done"
            job["result"] = result


def _purge_locked() -> None:
    now = time.time()
    expired = [
        jid for jid, j in _jobs.items()
        if (now - _job_ts(j)) > _JOB_TTL_SECONDS
    ]
    for jid in expired:
        del _jobs[jid]


def _job_ts(job: dict) -> float:
    try:
        return datetime.fromisoformat(job["created_at"]).timestamp()
    except (ValueError, TypeError):
        return 0.0
