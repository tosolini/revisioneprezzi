from sqlalchemy import text

from app.core.database import SessionLocal


def check_db() -> dict:
    try:
        db = SessionLocal()
        db.execute(text("SELECT 1"))
        db.close()
        return {"status": "ok"}
    except Exception as e:
        return {"status": "error", "detail": str(e)}


def health_status() -> dict:
    db_status = check_db()
    return {
        "app": "ok",
        "database": db_status["status"],
    }
