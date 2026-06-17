import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.user_settings import UserSettings
from app.schemas.settings import SettingsResponse, SettingsUpdate

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=SettingsResponse)
def get_settings(device_id: str, db: Session = Depends(get_db)):
    settings = (
        db.query(UserSettings)
        .filter(UserSettings.device_id == device_id)
        .first()
    )
    if not settings:
        settings = UserSettings(device_id=device_id, preferences_json="{}")
        db.add(settings)
        db.commit()
        db.refresh(settings)

    prefs = json.loads(settings.preferences_json or "{}")
    return SettingsResponse(
        id=settings.id,
        device_id=settings.device_id,
        preferences=prefs,
        created_at=settings.created_at,
        updated_at=settings.updated_at,
    )


@router.put("", response_model=SettingsResponse)
def upsert_settings(payload: SettingsUpdate, db: Session = Depends(get_db)):
    settings = (
        db.query(UserSettings)
        .filter(UserSettings.device_id == payload.device_id)
        .first()
    )
    if not settings:
        settings = UserSettings(
            device_id=payload.device_id, preferences_json="{}"
        )
        db.add(settings)

    current = json.loads(settings.preferences_json or "{}")
    current.update(payload.preferences)
    settings.preferences_json = json.dumps(current)

    db.commit()
    db.refresh(settings)

    prefs = json.loads(settings.preferences_json or "{}")
    return SettingsResponse(
        id=settings.id,
        device_id=settings.device_id,
        preferences=prefs,
        created_at=settings.created_at,
        updated_at=settings.updated_at,
    )
