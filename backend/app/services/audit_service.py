import json
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog


def log_event(
    db: Session,
    event_type: str,
    case_id: UUID | None = None,
    user_id: str | None = None,
    payload: dict | None = None,
    motivation: str | None = None,
    algorithm_version: str | None = None,
    commit: bool = True,
) -> AuditLog:
    entry = AuditLog(
        case_id=case_id,
        event_type=event_type,
        user_id=user_id,
        payload_json=json.dumps(payload) if payload else None,
        motivation=motivation,
        algorithm_version=algorithm_version,
    )
    db.add(entry)
    if commit:
        db.commit()
    return entry
