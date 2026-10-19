import re
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator

# Singolo CUP: 15 caratteri alfanumerici. La pratica può avere più CUP
# separati da virgola/punto-e-virgola/spazi; vengono normalizzati in
# "CUP1, CUP2" (maiuscole).
_CUP_SINGLE_RE = re.compile(r"^[A-Z0-9]{15}$")
_CIG_RE = re.compile(r"^[A-Za-z0-9]{10}$")
_CUP_SEPARATORS_RE = re.compile(r"[,;\s]+")

CUP_MAX_LENGTH = 255
TITLE_MAX_LENGTH = 255
CREATED_BY_MAX_LENGTH = 255
STAZIONE_MAX_LENGTH = 255


def _split_cup_list(raw: str) -> list[str]:
    return [c.upper() for c in _CUP_SEPARATORS_RE.split(raw.strip()) if c.strip()]


def parse_cup_field(value: str | None) -> str | None:
    """Valida e normalizza il campo CUP (singolo o lista).

    Ritorna la stringa normalizzata "CUP1, CUP2" o None se vuoto.
    Solleva ValueError con messaggio chiaro per l'utente in caso di
    codici non validi o lunghezza eccessiva."""
    if value is None:
        return None
    codes = _split_cup_list(value)
    if not codes:
        return None
    invalid = [c for c in codes if not _CUP_SINGLE_RE.match(c)]
    if invalid:
        shown = ", ".join(invalid[:3])
        extra = f" (e altri {len(invalid) - 3})" if len(invalid) > 3 else ""
        raise ValueError(
            f"CUP non validi: {shown}{extra}. "
            "Ogni CUP deve essere di 15 caratteri alfanumerici; "
            "separa più CUP con una virgola."
        )
    normalized = ", ".join(codes)
    if len(normalized) > CUP_MAX_LENGTH:
        raise ValueError(
            f"Troppi CUP: il campo supera i {CUP_MAX_LENGTH} caratteri "
            f"({len(normalized)}). Rimuovi alcuni codici."
        )
    return normalized


def parse_cig_field(value: str | None) -> str | None:
    """Valida il CIG (10 caratteri alfanumerici)."""
    if value is None:
        return None
    code = value.strip().upper()
    if not code:
        return None
    if not _CIG_RE.match(code):
        raise ValueError(
            f"CIG non valido: '{value.strip()}'. "
            "Il CIG deve essere di 10 caratteri alfanumerici."
        )
    return code


def _check_max_length(field: str, value: str | None, limit: int) -> str | None:
    if value is not None and len(value) > limit:
        raise ValueError(
            f"Il campo '{field}' supera i {limit} caratteri ({len(value)})."
        )
    return value


class CaseCreate(BaseModel):
    title: str
    created_by: str | None = None
    cig: str | None = None
    cup: str | None = None
    stazione_appaltante: str | None = None
    notes: str | None = None

    @field_validator("title")
    @classmethod
    def _title_length(cls, v: str) -> str:
        return _check_max_length("titolo", v, TITLE_MAX_LENGTH) or v

    @field_validator("created_by")
    @classmethod
    def _created_by_length(cls, v: str | None) -> str | None:
        return _check_max_length("creato da", v, CREATED_BY_MAX_LENGTH)

    @field_validator("stazione_appaltante")
    @classmethod
    def _stazione_length(cls, v: str | None) -> str | None:
        return _check_max_length("stazione appaltante", v, STAZIONE_MAX_LENGTH)

    @field_validator("cig")
    @classmethod
    def _cig_valid(cls, v: str | None) -> str | None:
        return parse_cig_field(v)

    @field_validator("cup")
    @classmethod
    def _cup_valid(cls, v: str | None) -> str | None:
        return parse_cup_field(v)


class CaseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    status: str
    current_step: int
    created_by: str | None
    cig: str | None
    cup: str | None
    stazione_appaltante: str | None
    notes: str | None
    created_at: datetime
    updated_at: datetime
    has_revision_plan: bool = False


class CaseListResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    status: str
    current_step: int
    created_by: str | None
    created_at: datetime
    has_revision_plan: bool = False


class CaseUpdate(BaseModel):
    title: str | None = None
    status: str | None = None
    current_step: int | None = None
    created_by: str | None = None
    cig: str | None = None
    cup: str | None = None
    stazione_appaltante: str | None = None
    notes: str | None = None

    @field_validator("title")
    @classmethod
    def _title_length(cls, v: str | None) -> str | None:
        return _check_max_length("titolo", v, TITLE_MAX_LENGTH)

    @field_validator("created_by")
    @classmethod
    def _created_by_length(cls, v: str | None) -> str | None:
        return _check_max_length("creato da", v, CREATED_BY_MAX_LENGTH)

    @field_validator("stazione_appaltante")
    @classmethod
    def _stazione_length(cls, v: str | None) -> str | None:
        return _check_max_length("stazione appaltante", v, STAZIONE_MAX_LENGTH)

    @field_validator("cig")
    @classmethod
    def _cig_valid(cls, v: str | None) -> str | None:
        return parse_cig_field(v)

    @field_validator("cup")
    @classmethod
    def _cup_valid(cls, v: str | None) -> str | None:
        return parse_cup_field(v)
