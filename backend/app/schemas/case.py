from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class CaseCreate(BaseModel):
    title: str
    created_by: str | None = None
    notes: str | None = None


class CaseUpdate(BaseModel):
    title: str | None = None
    status: str | None = None
    current_step: int | None = None
    notes: str | None = None


class CaseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    status: str
    current_step: int
    created_by: str | None
    notes: str | None
    created_at: datetime
    updated_at: datetime


class CaseListResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    status: str
    current_step: int
    created_by: str | None
    created_at: datetime
