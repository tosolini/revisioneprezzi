"""
Pydantic schemas per TOL (Tipologie Omogenee Lavorazioni)
"""
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


# TOL Master Schemas
class TolMasterBase(BaseModel):
    code: str = Field(..., description="Codice TOL (es. TOL.1)")
    short_description: str = Field(..., description="Descrizione breve")
    full_description: str = Field(..., description="Declaratoria completa")
    is_specialized: bool = Field(False, description="TOL specializzata (priorità assegnazione)")
    notes: str | None = None


class TolMasterResponse(TolMasterBase):
    sequence: int = Field(..., description="Numero sequenziale 1-20")

    class Config:
        from_attributes = True


class TolListResponse(BaseModel):
    """Lista TOL con info essenziali per selezione"""
    code: str
    sequence: int
    short_description: str
    is_specialized: bool


# TOL Assignment Schemas
class TolAssignmentCreate(BaseModel):
    tol_code: str = Field(..., description="Codice TOL da assegnare")
    weight_percent: float = Field(
        100.0,
        ge=0.0,
        le=100.0,
        description="Peso percentuale della TOL"
    )
    notes: str | None = None


class TolAssignmentUpdate(BaseModel):
    weight_percent: float | None = Field(None, ge=0.0, le=100.0)
    amount_allocated: float | None = None
    notes: str | None = None


class TolAssignmentResponse(BaseModel):
    id: UUID
    case_id: UUID
    tol_code: str
    weight_percent: float
    amount_allocated: float | None
    notes: str | None
    created_at: datetime
    tol_master: TolMasterBase | None = None

    class Config:
        from_attributes = True


class TolAssignmentBulkCreate(BaseModel):
    """Assegnazione multipla TOL a una pratica"""
    assignments: list[TolAssignmentCreate] = Field(..., min_length=1, max_length=20)

    @field_validator("assignments")
    @classmethod
    def validate_weights_sum(cls, v: list[TolAssignmentCreate]) -> list[TolAssignmentCreate]:
        """Verifica che i pesi sommino a 100%"""
        if len(v) > 1:
            total = sum(a.weight_percent for a in v)
            if abs(total - 100.0) > 0.01:
                raise ValueError(
                    f"I pesi percentuali devono sommarsi a 100% (attuale: {total}%)"
                )
        return v


# TOL Index Series Schemas
class TolIndexSeriesBase(BaseModel):
    tol_code: str
    series_id: str = Field(..., description="ID serie ISTAT/MIT")
    description: str | None = None
    is_active: bool = True


class TolIndexSeriesResponse(TolIndexSeriesBase):
    id: UUID
    valid_from: datetime | None
    valid_to: datetime | None
    created_at: datetime

    class Config:
        from_attributes = True


# Utility Schemas
class TolValidationResponse(BaseModel):
    """Risposta validazione assegnazioni TOL"""
    is_valid: bool
    total_weight: float
    errors: list[str] = []
    warnings: list[str] = []


class TolWithIndicesResponse(TolMasterResponse):
    """TOL con serie indici associate"""
    indices: list[TolIndexSeriesResponse] = []
