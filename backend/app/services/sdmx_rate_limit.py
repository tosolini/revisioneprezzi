"""Rate limiter condiviso per l'API SDMX ISTAT.

Istat impone 5 query/minuto per IP, oltre il quale scatta un blocco di accesso
di 1-2 giorni (https://www.istat.it/classificazioni-e-strumenti/web-services-sdmx/).
API FastAPI e script CLI (scripts/sync_indices.py) condividono lo stesso IP di
uscita, quindi il pacing e' serializzato anche tra processi: l'ultimo timestamp
di richiesta e' persistito su file sotto lock esclusivo (flock).
"""

import json
import os
import random
import threading
import time
from pathlib import Path

MIN_INTERVAL = 12.0  # 60s / 5 query al minuto
JITTER_MAX = 2.0  # margine anti-jitter aggiunto al minimo
DEFAULT_MAX_WAIT = 45.0

_STATE_PATH = Path(__file__).resolve().parents[2] / "seeds" / ".sdmx_rate_limit.json"

_lock = threading.Lock()


class RateLimitTimeout(Exception):
    """Slot di rate limit non disponibile entro max_wait."""

    def __init__(self, wait_seconds: float):
        self.wait_seconds = wait_seconds
        super().__init__(f"Istat consente 5 query/minuto per IP: riprova tra {wait_seconds:.0f}s")


def wait_for_slot(max_wait: float = DEFAULT_MAX_WAIT) -> float:
    """Prende uno slot di richiesta SDMX, attendendo fino a max_wait secondi.

    Ritorna i secondi effettivamente attesi (0 se lo slot era libero).
    Alza RateLimitTimeout se la finestra non si libera entro max_wait.
    """
    with _lock:
        with _open_state_locked() as f:
            last = _read_last_request(f)
            now = time.time()
            elapsed = now - last
            needed = MIN_INTERVAL + random.uniform(0.0, JITTER_MAX) - elapsed
            wait_time = max(0.0, needed)
            if wait_time > max_wait:
                raise RateLimitTimeout(wait_time)
            if wait_time > 0:
                time.sleep(wait_time)
            _write_last_request(f, time.time())
            return wait_time


def _open_state_locked():
    try:
        _STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        f = open(_STATE_PATH, "a+")
    except OSError:
        return _NullFile()
    _acquire_file_lock(f)
    return _LockedFile(f)


def _read_last_request(f) -> float:
    try:
        f.seek(0)
        return float(json.loads(f.read() or "{}").get("last_request", 0.0))
    except (ValueError, TypeError, OSError):
        return 0.0


def _write_last_request(f, ts: float) -> None:
    try:
        f.seek(0)
        f.truncate()
        json.dump({"last_request": ts}, f)
        f.flush()
        if hasattr(f, "fileno"):
            os.fsync(f.fileno())
    except (OSError, AttributeError):
        pass  # best effort: la serializzazione in-process resta attiva


def _acquire_file_lock(f):
    try:
        import fcntl

        fcntl.flock(f.fileno(), fcntl.LOCK_EX)
    except (ImportError, OSError):
        pass


def _release_file_lock(f):
    try:
        import fcntl

        fcntl.flock(f.fileno(), fcntl.LOCK_UN)
    except (ImportError, OSError):
        pass


class _LockedFile:
    def __init__(self, f):
        self._f = f

    def __enter__(self):
        return self._f

    def __exit__(self, *exc):
        try:
            self._f.flush()
        except OSError:
            pass
        _release_file_lock(self._f)
        self._f.close()
        return False


class _NullFile:
    """Fallback quando il file di stato non e' scrivibile: nessun pacing
    cross-process, ma il lock in-process continua a valere."""

    def __enter__(self):
        return _NullFile()

    def __exit__(self, *exc):
        return False
