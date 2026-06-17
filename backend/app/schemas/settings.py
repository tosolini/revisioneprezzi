from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class SettingsUpdate(BaseModel):
    device_id: str
    preferences: dict[str, str | None]


class SettingsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    device_id: str
    preferences: dict
    created_at: datetime
    updated_at: datetime
