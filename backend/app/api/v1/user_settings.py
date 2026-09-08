import json

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.user_settings import UserSettings
from app.schemas.settings import SettingsResponse, SettingsUpdate

router = APIRouter(prefix="/settings", tags=["settings"])

GLOBAL_DEVICE_ID = "global"
SHARED_KEYS = {"prefilled_ente"}


def _load_prefs(settings: UserSettings | None) -> dict:
    if settings is None:
        return {}
    return json.loads(settings.preferences_json or "{}")


def _get_global(db: Session) -> UserSettings | None:
    return db.query(UserSettings).filter(UserSettings.device_id == GLOBAL_DEVICE_ID).first()


def _merged_prefs(device_prefs: dict, global_prefs: dict) -> dict:
    merged = {**global_prefs, **device_prefs}
    for k in SHARED_KEYS:
        if k in global_prefs:
            merged[k] = global_prefs[k]
    return merged


@router.get("", response_model=SettingsResponse)
def get_settings(device_id: str, db: Session = Depends(get_db)):
    settings = db.query(UserSettings).filter(UserSettings.device_id == device_id).first()
    if not settings:
        settings = UserSettings(device_id=device_id, preferences_json="{}")
        db.add(settings)
        db.commit()
        db.refresh(settings)

    global_settings = None
    if device_id != GLOBAL_DEVICE_ID:
        global_settings = _get_global(db)

    device_prefs = _load_prefs(settings)
    global_prefs = _load_prefs(global_settings)

    # One-time promotion: device row set before the shared-default fix moves up.
    if (
        device_id != GLOBAL_DEVICE_ID
        and "prefilled_ente" not in global_prefs
        and "prefilled_ente" in device_prefs
    ):
        if global_settings is None:
            global_settings = UserSettings(
                device_id=GLOBAL_DEVICE_ID,
                preferences_json=json.dumps({"prefilled_ente": device_prefs["prefilled_ente"]}),
            )
            db.add(global_settings)
        else:
            global_prefs["prefilled_ente"] = device_prefs["prefilled_ente"]
            global_settings.preferences_json = json.dumps(global_prefs)
        del device_prefs["prefilled_ente"]
        settings.preferences_json = json.dumps(device_prefs)
        db.commit()
        db.refresh(settings)
        db.refresh(global_settings)
        global_prefs = _load_prefs(global_settings)
        device_prefs = _load_prefs(settings)

    prefs = _merged_prefs(device_prefs, global_prefs)
    return SettingsResponse(
        id=settings.id,
        device_id=settings.device_id,
        preferences=prefs,
        created_at=settings.created_at,
        updated_at=settings.updated_at,
    )


@router.put("", response_model=SettingsResponse)
def upsert_settings(payload: SettingsUpdate, db: Session = Depends(get_db)):
    settings = db.query(UserSettings).filter(UserSettings.device_id == payload.device_id).first()
    if not settings:
        settings = UserSettings(device_id=payload.device_id, preferences_json="{}")
        db.add(settings)

    shared = {k: v for k, v in payload.preferences.items() if k in SHARED_KEYS}
    local = {k: v for k, v in payload.preferences.items() if k not in SHARED_KEYS}

    if shared and payload.device_id != GLOBAL_DEVICE_ID:
        global_settings = _get_global(db)
        if not global_settings:
            global_settings = UserSettings(device_id=GLOBAL_DEVICE_ID, preferences_json="{}")
            db.add(global_settings)
            db.flush()
        current_global = _load_prefs(global_settings)
        current_global.update(shared)
        global_settings.preferences_json = json.dumps(current_global)
        # Drop shared keys from the device row so the merge can't shadow them.
        current = _load_prefs(settings)
        for k in shared:
            current.pop(k, None)
        current.update(local)
        settings.preferences_json = json.dumps(current)
    else:
        current = _load_prefs(settings)
        current.update(payload.preferences)
        settings.preferences_json = json.dumps(current)

    db.commit()
    db.refresh(settings)

    global_settings = None
    if payload.device_id != GLOBAL_DEVICE_ID:
        global_settings = _get_global(db)
    prefs = _merged_prefs(_load_prefs(settings), _load_prefs(global_settings))
    return SettingsResponse(
        id=settings.id,
        device_id=settings.device_id,
        preferences=prefs,
        created_at=settings.created_at,
        updated_at=settings.updated_at,
    )
