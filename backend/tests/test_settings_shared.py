import json
import uuid

import pytest

from app.core.database import SessionLocal
from app.models.user_settings import UserSettings


def _uid(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def _by_device(s, device_id: str):
    return s.query(UserSettings).filter(UserSettings.device_id == device_id).first()


@pytest.fixture
def _global_guard():
    """Snapshot the shared row; restore it after each test (dev DB is real)."""
    s = SessionLocal()
    row = _by_device(s, "global")
    saved = row.preferences_json if row else None
    s.close()
    yield
    s = SessionLocal()
    try:
        row = _by_device(s, "global")
        if saved is None:
            if row:
                s.delete(row)
        else:
            if not row:
                row = UserSettings(device_id="global", preferences_json=saved)
                s.add(row)
            else:
                row.preferences_json = saved
        s.commit()
    finally:
        s.close()


def _cleanup(*device_ids: str):
    s = SessionLocal()
    try:
        s.query(UserSettings).filter(UserSettings.device_id.in_(device_ids)).delete(
            synchronize_session=False
        )
        s.commit()
    finally:
        s.close()


def _put(client, device_id: str, prefs: dict):
    return client.put(
        "/api/v1/settings",
        json={"device_id": device_id, "preferences": prefs},
    )


def _get(client, device_id: str):
    return client.get("/api/v1/settings", params={"device_id": device_id})


def test_shared_ente_visible_on_unknown_device(client, _global_guard):
    a, b = _uid("devA"), _uid("devB")
    try:
        r = _put(client, a, {"prefilled_ente": "Comune di Test"})
        assert r.status_code == 200
        r = _get(client, b)
        assert r.status_code == 200
        assert r.json()["preferences"].get("prefilled_ente") == ("Comune di Test")
    finally:
        _cleanup(a, b)


def test_non_shared_key_stays_device_local(client, _global_guard):
    a, b = _uid("devA"), _uid("devB")
    try:
        r = _put(client, a, {"theme_local": "dark"})
        assert r.status_code == 200
        r = _get(client, b)
        assert r.status_code == 200
        assert "theme_local" not in r.json()["preferences"]
    finally:
        _cleanup(a, b)


def test_promotion_moves_legacy_device_value_to_global(client, _global_guard, db):
    # Global must be absent for this test; guard restores it afterwards.
    s = SessionLocal()
    s.query(UserSettings).filter(UserSettings.device_id == "global").delete(
        synchronize_session=False
    )
    s.commit()
    s.close()

    legacy, other = _uid("legacy"), _uid("other")
    try:
        # Legacy row written before the fix: shared key on device row.
        s = SessionLocal()
        s.add(
            UserSettings(
                device_id=legacy,
                preferences_json=json.dumps({"prefilled_ente": "Legacy Ente"}),
            )
        )
        s.commit()
        s.close()

        r = _get(client, legacy)
        assert r.status_code == 200
        assert r.json()["preferences"].get("prefilled_ente") == "Legacy Ente"

        # Promoted: a second device sees it too.
        r = _get(client, other)
        assert r.json()["preferences"].get("prefilled_ente") == "Legacy Ente"

        # Explicit rewrite wins; later legacy promotion must not clobber.
        r = _put(client, other, {"prefilled_ente": "Nuovo Ente"})
        assert r.status_code == 200
        stale = _uid("stale")
        s = SessionLocal()
        s.add(
            UserSettings(
                device_id=stale,
                preferences_json=json.dumps({"prefilled_ente": "Stale Ente"}),
            )
        )
        s.commit()
        s.close()
        r = _get(client, stale)
        assert r.json()["preferences"].get("prefilled_ente") == "Nuovo Ente"
        _cleanup(stale)
    finally:
        _cleanup(legacy, other)


def test_clearing_shared_ente_empties_it_for_all(client, _global_guard):
    a, b = _uid("devA"), _uid("devB")
    try:
        _put(client, a, {"prefilled_ente": "Da Cancellare"})
        r = _put(client, a, {"prefilled_ente": None})
        assert r.status_code == 200
        r = _get(client, b)
        assert r.json()["preferences"].get("prefilled_ente") is None
    finally:
        _cleanup(a, b)
