from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class WizardAnswerCreate(BaseModel):
    step: int
    field_key: str
    field_value: str | None = None


class WizardAnswerResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    step: int
    field_key: str
    field_value: str | None
    created_at: datetime


class WizardStepSave(BaseModel):
    answers: list[WizardAnswerCreate]
