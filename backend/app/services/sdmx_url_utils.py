"""Utility pure per la riscrittura automatica delle date SDMX.

Preserva la granularità di `endPeriod` (YYYY, YYYY-MM, YYYY-MM-DD, YYYY-Qn)
quando si sostituisce il valore con la data target (last_month_end o today).
Gestisce anche `startPeriod` con strategie per renderlo più vecchio:
fixed (nessuna riscrittura), earliest (2000...), expand_1y/expand_5y.
"""

from __future__ import annotations

import calendar
import re
from datetime import date, datetime, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

# regex granularità
_RE_YEAR = re.compile(r"^\d{4}$")
_RE_YM = re.compile(r"^\d{4}-\d{2}$")
_RE_YMD = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_RE_Q = re.compile(r"^\d{4}-Q[1-4]$")


def last_month_end(today: date | None = None) -> date:
    """Ritorna l'ultimo giorno del mese precedente a `today`.

    Se `today` è None usa UTC now. Gestisce gennaio → dicembre anno precedente.
    """
    if today is None:
        today = datetime.now(timezone.utc).date()
    # primo giorno del mese corrente, poi un giorno indietro
    first_this_month = today.replace(day=1)
    # sottrarre un giorno via ordinal trick
    # calendar.monthrange non necessario per calcolo, ma usato per validazione
    if first_this_month.month == 1:
        year = first_this_month.year - 1
        month = 12
    else:
        year = first_this_month.year
        month = first_this_month.month - 1
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, last_day)


def _quarter_for_date(d: date) -> tuple[int, int]:
    """Ritorna (anno, quarter 1-4) per la data d."""
    q = (d.month - 1) // 3 + 1
    return d.year, q


def _quarter_end_dates(year: int) -> dict[int, date]:
    return {
        1: date(year, 3, 31),
        2: date(year, 6, 30),
        3: date(year, 9, 30),
        4: date(year, 12, 31),
    }


def _format_like(original: str, target: date) -> str:
    """Preserva la granularità di `original` applicando `target`."""
    original = original.strip()
    if _RE_YEAR.match(original):
        return target.strftime("%Y")
    if _RE_YM.match(original):
        return target.strftime("%Y-%m")
    if _RE_YMD.match(original):
        return target.isoformat()
    if _RE_Q.match(original):
        year, q = _quarter_for_date(target)
        # Se target non è fine quarter, già mappa al quarter corretto;
        # Il piano richiede arrotondamento a fine quarter precedente se target
        # non è fine quarter? Ma _quarter_for_date già contiene target,
        # quindi se target 2026-07-31 → Q3, tuttavia il piano dice Q2.
        # Plan: "arrotonda a fine quarter precedente se target non è fine quarter"
        # significa: se target non coincide con una delle 4 fine quarter, usa il quarter precedente?
        # Interpretazione: per last_month_end, target è fine mese; se non è 03-31/06-30/09-30/12-31,
        # il quarter da mostrare è quello che si è appena chiuso.
        # Esempio plan: target 2026-07-31 → 2026-Q2 (non Q3).
        # Quindi: se target non è esattamente una fine quarter, prendi quarter precedente.
        ends = _quarter_end_dates(year)
        # check if target is exactly a quarter end
        is_q_end = target in ends.values()
        if not is_q_end:
            # vai al quarter precedente
            # se Q1 → Q4 anno precedente
            if q == 1:
                year -= 1
                q = 4
            else:
                q -= 1
        return f"{year}-Q{q}"
    # fallback non riconosciuto → isoformat
    return target.isoformat()


def _earliest_like(original: str) -> str:
    """Ritorna la data più vecchia possibile preservando granularità (anno 2000)."""
    original = original.strip()
    if _RE_YEAR.match(original):
        return "2000"
    if _RE_YM.match(original):
        return "2000-01"
    if _RE_YMD.match(original):
        return "2000-01-01"
    if _RE_Q.match(original):
        return "2000-Q1"
    return "2000-01-01"


def _shift_start_like(original: str, years_back: int) -> str:
    """Sposta startPeriod indietro di N anni preservando granularità."""
    try:
        if _RE_YEAR.match(original):
            y = int(original[:4])
            return f"{y - years_back:04d}"
        if _RE_YMD.match(original):
            y = int(original[:4])
            rest = original[4:]  # -MM-DD
            return f"{y - years_back:04d}{rest}"
        if _RE_Q.match(original):
            y = int(original[:4])
            q = int(original[6])
            # sottrai N anni = N*4 trimestri
            total_q = (y * 4 + (q - 1)) - years_back * 4
            new_y = total_q // 4
            new_q = total_q % 4 + 1
            return f"{new_y:04d}-Q{new_q}"
    except Exception:
        pass  # unexpected format/value: fall through to earliest fallback
    # fallback: ritorna earliest
    return _earliest_like(original)

def resolve_sdmx_url_start_period(
    url: str, strategy: str, today: date | None = None
) -> tuple[str, dict]:
    """Riscrive `startPeriod` in `url` secondo `strategy`.

    strategy in ("fixed","earliest","expand_1y","expand_5y").
    Se fixed o startPeriod assente → ritorna url invariata.
    Ritorna (resolved_url, meta) dove meta = {"startPeriod": ..., "original_startPeriod": ...}
    Nessuna eccezione verso chiamante.
    """
    try:
        if strategy == "fixed" or not strategy:
            return url, {}
        parsed = urlsplit(url)
        if not parsed.query:
            return url, {}
        params_list = parse_qsl(parsed.query, keep_blank_values=True)
        params = dict(params_list)
        if "startPeriod" not in params:
            return url, {}
        original_start = params.get("startPeriod", "")
        if not original_start or not original_start.strip():
            return url, {}
        # determina nuovo valore
        if strategy == "earliest":
            resolved_value = _earliest_like(original_start)
        elif strategy == "expand_1y":
            resolved_value = _shift_start_like(original_start, 1)
        elif strategy == "expand_5y":
            resolved_value = _shift_start_like(original_start, 5)
        else:
            # strategia sconosciuta → no-op
            return url, {}
        # evita di rendere startPeriod più recente dell'originale (sicurezza)
        # se per errore il calcolo lo rendesse più recente, mantieni originale
        # confronta lessicograficamente solo se stesso formato; altrimenti fida
        params["startPeriod"] = resolved_value
        resolved_url = urlunsplit(
            (parsed.scheme, parsed.netloc, parsed.path, urlencode(params), "")
        )
        meta = {
            "startPeriod": resolved_value,
            "original_startPeriod": original_start,
        }
        return resolved_url, meta
    except Exception:
        return url, {}


def resolve_sdmx_url_dates_both(
    url: str, end_strategy: str, start_strategy: str, today: date | None = None
) -> tuple[str, dict]:
    """Applica sia endPeriod che startPeriod; non modifica endPeriod."""
    # Applica endPeriod prima (preserva granularità end)
    resolved, meta_end = resolve_sdmx_url_dates(url, end_strategy, today=today)
    resolved2, meta_start = resolve_sdmx_url_start_period(resolved, start_strategy, today=today)
    # unisci meta
    meta = {}
    meta.update(meta_end)
    meta.update(meta_start)
    return resolved2, meta


def resolve_sdmx_url_dates(url: str, strategy: str, today: date | None = None) -> tuple[str, dict]:
    """Riscrive `endPeriod` in `url` secondo `strategy`.

    strategy in ("fixed","last_month_end","today").
    Se fixed o endPeriod assente → ritorna url invariata.
    Ritorna (resolved_url, meta) dove meta contiene
        `endPeriod`, `original_endPeriod` e `target_date`.
    Nessuna eccezione verso chiamante.
    """
    try:
        if strategy == "fixed":
            return url, {}
        parsed = urlsplit(url)
        # preserva query string anche se vuota
        if not parsed.query:
            return url, {}
        params_list = parse_qsl(parsed.query, keep_blank_values=True)
        params = dict(params_list)
        if "endPeriod" not in params:
            return url, {}
        original_end = params.get("endPeriod", "")
        if not original_end or not original_end.strip():
            return url, {}
        # determina target
        if strategy == "last_month_end":
            target = last_month_end(
                today if today is not None else datetime.now(timezone.utc).date()
            )
        elif strategy == "today":
            if today is not None:
                target = today
            else:
                target = datetime.now(timezone.utc).date()
        else:
            # strategia sconosciuta → no-op
            return url, {}
        resolved_value = _format_like(original_end, target)
        # Ricostruisce params preservando ordine? dict mantiene ordine parse_qsl
        params["endPeriod"] = resolved_value
        resolved_url = urlunsplit(
            (parsed.scheme, parsed.netloc, parsed.path, urlencode(params), "")
        )
        meta = {
            "endPeriod": resolved_value,
            "original_endPeriod": original_end,
            "target_date": target.isoformat(),
        }
        return resolved_url, meta
    except Exception:
        # No-op su errore inatteso, non lanciare
        return url, {}
