import os
import tempfile
from typing import Optional

from fastapi import FastAPI, File, UploadFile, HTTPException

from app.extractors import DocxExtractor, PdfExtractor
from app.patterns import PATTERNS
from app.schemas import ExtractionResult, ExtractResponse

app = FastAPI(title="revprezzi-parser", version="0.1.0")

BACKEND_URL = os.getenv("BACKEND_URL", "http://backend:8000")

# Reject oversized uploads to avoid memory exhaustion (DoS). Mirrors the
# backend/nginx 20 MB limit.
MAX_UPLOAD_BYTES = 20 * 1024 * 1024


def detect_format(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower()
    if ext in ("docx",):
        return "docx"
    if ext in ("pdf",):
        return "pdf"
    raise HTTPException(status_code=400, detail=f"Formato non supportato: .{ext}")


def extract_text(file_path: str, fmt: str) -> str:
    if fmt == "docx":
        return DocxExtractor().extract(file_path)
    if fmt == "pdf":
        return PdfExtractor().extract(file_path)
    raise HTTPException(status_code=400, detail=f"Formato sconosciuto: {fmt}")


def apply_patterns(text: str) -> dict:
    result: dict[str, str | None] = {}
    for field, patterns in PATTERNS.items():
        for pat in patterns:
            m = pat.search(text)
            if m:
                try:
                    result[field] = m.group(1).strip()
                except IndexError:
                    result[field] = m.group(0).strip()
                break
        result.setdefault(field, None)
    return result


def clean_importo(raw: Optional[str]) -> Optional[float]:
    if not raw:
        return None
    cleaned = raw.replace(".", "").replace(",", ".")
    try:
        return float(cleaned)
    except ValueError:
        return None


def clean_durata(raw: Optional[str]) -> Optional[int]:
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def build_result(raw_text: str, matched: dict) -> ExtractionResult:
    return ExtractionResult(
        ente=matched.get("ente"),
        cig=matched.get("cig"),
        cup=matched.get("cup"),
        oggetto=matched.get("oggetto"),
        cpv_primary=matched.get("cpv"),
        importo_complessivo=clean_importo(matched.get("importo_complessivo")),
        durata_mesi=clean_durata(matched.get("durata_mesi")),
        natura=matched.get("natura"),
        data_stipula=matched.get("data_stipula"),
        operatore_economico=matched.get("operatore_economico"),
        raw_text=raw_text,
    )


@app.post("/extract", response_model=ExtractResponse)
async def extract(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(400, "Nessun file fornito")

    fmt = detect_format(file.filename)

    contents = b""
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        contents += chunk
        if len(contents) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                413,
                f"File troppo grande (limite {MAX_UPLOAD_BYTES // (1024 * 1024)} MB)",
            )

    with tempfile.NamedTemporaryFile(delete=False, suffix=f".{fmt}") as tmp:
        tmp.write(contents)
        tmp_path = tmp.name

    try:
        raw_text = extract_text(tmp_path, fmt)
    finally:
        os.unlink(tmp_path)

    if not raw_text.strip():
        raise HTTPException(422, "Impossibile estrarre testo dal documento")

    matched = apply_patterns(raw_text)
    result = build_result(raw_text, matched)
    return ExtractResponse(fields=result)
