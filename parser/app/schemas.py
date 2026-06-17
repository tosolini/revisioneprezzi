from pydantic import BaseModel
from typing import Optional


class ExtractionResult(BaseModel):
    ente: Optional[str] = None
    cig: Optional[str] = None
    cup: Optional[str] = None
    oggetto: Optional[str] = None
    cpv_primary: Optional[str] = None
    importo_complessivo: Optional[float] = None
    durata_mesi: Optional[int] = None
    natura: Optional[str] = None
    data_stipula: Optional[str] = None
    operatore_economico: Optional[str] = None
    raw_text: str


class ExtractResponse(BaseModel):
    fields: ExtractionResult
