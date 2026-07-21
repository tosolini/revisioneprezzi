import io
import time
import json
from pathlib import Path
from typing import Any, Dict, List, Tuple

from sqlalchemy.orm import Session

from app.models.ateco_catalog import AtecoCatalog

import httpx

SDMX_URL_TEMPLATE = "https://esploradati.istat.it/SDMXWS/rest/structure/codelist/{agency}/{id}/{version}?format=jsonstructure"

HTTP_TIMEOUT = {
    "connect": 120.0,
    "read": 120.0,
    "write": 120.0,
    "pool": 120.0,
}
RATE_LIMIT_DELAY = 12       # ISTAT max 5 req/min → at least 12s between requests

CACHE_DIR = Path(__file__).resolve().parents[1] / "data" / "sdmx_cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _is_code_list(lst: List[Any]) -> bool:
    if not isinstance(lst, list) or len(lst) == 0:
        return False
    return all(isinstance(x, dict) and ("id" in x or "value" in x or "@id" in x) for x in lst)


def _extract_codes_from_obj(obj: Any) -> List[Dict[str, str]]:
    found: List[Dict[str, str]] = []

    def walk(x: Any):
        if isinstance(x, dict):
            for k, v in x.items():
                if isinstance(v, list) and _is_code_list(v):
                    for item in v:
                        code = item.get("id") or item.get("value") or item.get("@id")
                        desc = None

                        desc_src = item.get("Description")
                        if desc_src is not None:
                            if isinstance(desc_src, list) and len(desc_src) > 0:
                                first = desc_src[0]
                                if isinstance(first, dict):
                                    desc = first.get("#text") or first.get("value") or ""
                                else:
                                    desc = str(first)
                            elif isinstance(desc_src, dict):
                                desc = desc_src.get("en") or next(iter(desc_src.values()), "")
                            else:
                                desc = str(desc_src)

                        if desc is None:
                            if "description" in item:
                                d = item.get("description")
                                if isinstance(d, dict):
                                    desc = d.get("en") or next(iter(d.values()), "")
                                else:
                                    desc = str(d)
                            elif "name" in item:
                                n = item.get("name")
                                if isinstance(n, dict):
                                    desc = n.get("en") or next(iter(n.values()), "")
                                else:
                                    desc = str(n)
                            elif "names" in item:
                                n = item.get("names")
                                if isinstance(n, dict):
                                    desc = n.get("en") or next(iter(n.values()), "")
                                else:
                                    desc = str(n)
                            elif "label" in item:
                                desc = item.get("label")

                        if code:
                            found.append({"code": str(code), "description": desc or ""})
                else:
                    walk(v)
        elif isinstance(x, list):
            for it in x:
                walk(it)

    walk(obj)
    return found


def _cache_path(agency: str, cand: str, version: str) -> Path:
    safe_name = f"{agency}_{cand}_{version}".replace('/', '_')
    return CACHE_DIR / f"{safe_name}.json"


def _read_cache(agency: str, cand: str, version: str, ttl_seconds: int) -> Any | None:
    p = _cache_path(agency, cand, version)
    if not p.exists():
        return None
    try:
        with p.open('r', encoding='utf-8') as f:
            obj = json.load(f)
        fetched = obj.get("fetched_at", 0)
        if time.time() - fetched > ttl_seconds:
            return None
        return obj.get("payload")
    except Exception:
        return None


def _write_cache(agency: str, cand: str, version: str, payload: Any) -> None:
    p = _cache_path(agency, cand, version)
    try:
        with p.open('w', encoding='utf-8') as f:
            json.dump({"fetched_at": int(time.time()), "payload": payload}, f)
    except Exception:
        pass


def _fetch_payload(agency: str, cand: str, version: str, headers: dict, use_cache: bool, ttl_seconds: int) -> Any | None:
    """Try to get payload from cache or fetch from SDMX. Returns None on failure."""
    if use_cache:
        payload = _read_cache(agency, cand, version, ttl_seconds)
        if payload is not None:
            return payload

    url = SDMX_URL_TEMPLATE.format(agency=agency, id=cand, version=version)
    try:
        resp = httpx.get(url, headers=headers, timeout=httpx.Timeout(**HTTP_TIMEOUT))
    except Exception:
        return None
    if resp.status_code != 200:
        return None
    try:
        payload = resp.json()
    except Exception:
        return None
    try:
        _write_cache(agency, cand, version, payload)
    except Exception:
        pass
    return payload


def _upsert_codes(db: Session, codes: List[Dict[str, str]]) -> int:
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    imported = 0
    for item in codes:
        code = item.get("code")
        desc = item.get("description") or ""
        if not code:
            continue
        existing = db.query(AtecoCatalog).filter(AtecoCatalog.ateco_code == code).first()
        if existing:
            existing.description = desc
            existing.updated_at = now
        else:
            db.add(AtecoCatalog(ateco_code=code, description=desc, updated_at=now))
        imported += 1
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    return imported


def import_from_sdmx(db: Session, agency: str = "IT1", artifact_id: str = None, version: str = "1.0", use_cache: bool = True, ttl_seconds: int = 24 * 3600) -> Tuple[int, List[str]]:
    """
    Import ATECO codelist from ISTAT SDMX.

    If artifact_id is provided, tries only that.
    Otherwise tries the known-good candidate, then fallbacks with rate-limit-aware delays.

    Returns (imported_count, tried_candidates).
    """
    candidates = [artifact_id] if artifact_id else ["ATECO2025"]
    extra = ["ATECO", "ATECO2022", "CL_ACT", "CL_ATECO", "ACT"]
    tried: List[str] = []
    had_network_error = False

    headers = {"Accept": "application/vnd.sdmx.structure+json;version=1.0"}

    # --- Primary candidates ---
    for cand in candidates:
        if not cand:
            continue
        tried.append(cand)

        payload = _fetch_payload(agency, cand, version, headers, use_cache, ttl_seconds)
        if payload is None:
            had_network_error = True
            time.sleep(RATE_LIMIT_DELAY)
            continue

        codes = _extract_codes_from_obj(payload)
        if not codes:
            time.sleep(RATE_LIMIT_DELAY)
            continue

        return _upsert_codes(db, codes), tried

    # --- Fallback candidates ---
    # Only try fallbacks if the server was reachable but returned wrong data (wrong artifact ID).
    # If we had a network error, all candidates will fail the same way — skip.
    if not had_network_error:
        for i, cand in enumerate(extra):
            if cand in tried:
                continue
            if i > 0:
                time.sleep(RATE_LIMIT_DELAY)
            tried.append(cand)

            payload = _fetch_payload(agency, cand, version, headers, use_cache, ttl_seconds)
            if payload is None:
                continue

            codes = _extract_codes_from_obj(payload)
            if not codes:
                continue

            return _upsert_codes(db, codes), tried

    return 0, tried


def import_from_zip(db: Session, zip_bytes: bytes) -> int:
    """Parse ATECO XML from a ZIP file and upsert all codes into the database.
    Returns the number of imported/updated entries.
    """
    import zipfile
    from defusedxml.ElementTree import fromstring as safe_fromstring

    codes: List[Dict[str, str]] = []

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        xml_names = [n for n in zf.namelist() if n.lower().endswith('.xml')]
        if not xml_names:
            raise ValueError("Nessun file XML trovato nel ZIP")
        xml_content = zf.read(xml_names[0])
        root = safe_fromstring(xml_content)

    def _text(el):
        return el.text.strip() if el is not None and el.text else ''

    for sezione in root.findall('Sezione'):
        sez_code = _text(sezione.find('Codice'))
        sez_title = _text(sezione.find('Titolo'))
        codes.append({"code": sez_code, "description": sez_title})

        for div in sezione.findall('Divisione'):
            div_code = _text(div.find('Codice'))
            div_title = _text(div.find('Titolo'))
            codes.append({"code": div_code, "description": div_title})

            for grp in div.findall('Gruppo'):
                grp_code = div_code + _text(grp.find('Codice'))
                grp_title = _text(grp.find('Titolo'))
                codes.append({"code": grp_code, "description": grp_title})

                for cls in grp.findall('Classe'):
                    cls_code = grp_code + _text(cls.find('Codice'))
                    cls_title = _text(cls.find('Titolo'))
                    codes.append({"code": cls_code, "description": cls_title})

                    for cat in cls.findall('Categoria'):
                        cat_code = cls_code + _text(cat.find('Codice'))
                        cat_title = _text(cat.find('Titolo'))
                        codes.append({"code": cat_code, "description": cat_title})

                        for sub in cat.findall('Sottocategoria'):
                            sub_code = cat_code + _text(sub.find('Codice'))
                            sub_title = _text(sub.find('Titolo'))
                            codes.append({"code": sub_code, "description": sub_title})

    return _upsert_codes(db, codes)
