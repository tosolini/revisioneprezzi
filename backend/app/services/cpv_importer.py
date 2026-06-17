from pathlib import Path
import xml.etree.ElementTree as ET
from defusedxml.ElementTree import parse as safe_parse
from typing import Tuple
from sqlalchemy.orm import Session
from app.models.cpv_catalog import CpvCatalog


def _parse_cpv_xml(root: ET.Element, db: Session) -> int:
    imported = 0
    for cpv in root.findall('.//CPV'):
        code = cpv.get('CODE')
        if not code:
            continue
        desc = None
        for text in cpv.findall('TEXT'):
            lang = text.get('LANG')
            if lang and lang.upper() == 'IT':
                desc = (text.text or '').strip()
                break
        if not desc:
            for text in cpv.findall('TEXT'):
                lang = text.get('LANG')
                if lang and lang.upper() == 'EN':
                    desc = (text.text or '').strip()
                    break
        if not desc:
            t = cpv.find('TEXT')
            desc = (t.text or '').strip() if t is not None and t.text else ''

        existing = db.query(CpvCatalog).filter(CpvCatalog.cpv_code == code).first()
        if existing:
            existing.description = desc
        else:
            db.add(CpvCatalog(cpv_code=code, description=desc))
        imported += 1
    return imported


def import_from_xml(db: Session, xml_path: Path | None = None) -> Tuple[int, str]:
    """Import CPV codes from local XML file. Returns (imported_count, used_path)"""
    if xml_path is None:
        repo_root = Path(__file__).resolve().parents[3]
        xml_path = repo_root / 'cpv_2008_xml' / 'cpv_2008.xml'
    if not xml_path.exists():
        return 0, str(xml_path)

    tree = safe_parse(str(xml_path))
    root = tree.getroot()
    imported = _parse_cpv_xml(root, db)

    try:
        db.commit()
    except Exception:
        db.rollback()

    _write_status(str(xml_path))

    return imported, str(xml_path)


def import_from_zip_bytes(db: Session, zip_bytes: bytes) -> Tuple[int, str]:
    """Import CPV codes from ZIP file bytes. Returns (imported_count, source_name)"""
    import zipfile
    import io

    source_name = "upload"

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        xml_names = [n for n in zf.namelist() if n.endswith('.xml') and 'code_cpv_suppl' not in n]
        if not xml_names:
            xml_names = [n for n in zf.namelist() if n.endswith('.xml')]
        if not xml_names:
            raise ValueError("Nessun file XML trovato nel ZIP")
        source_name = xml_names[0]
        with zf.open(xml_names[0]) as f:
            tree = safe_parse(f)
            root = tree.getroot()

    imported = _parse_cpv_xml(root, db)

    try:
        db.commit()
    except Exception:
        db.rollback()

    _write_status(source_name)

    return imported, source_name


def _write_status(path: str) -> None:
    import json
    import time
    try:
        status_dir = Path(__file__).resolve().parents[1] / 'data'
        status_dir.mkdir(parents=True, exist_ok=True)
        status_file = status_dir / 'cpv_import_status.json'
        with status_file.open('w', encoding='utf-8') as f:
            json.dump({'last_imported_at': int(time.time()), 'path': path}, f)
    except Exception:
        pass
