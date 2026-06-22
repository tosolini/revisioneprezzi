import logging

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.core.uploads import read_upload_limited

_LOG = logging.getLogger("backup")
router = APIRouter(prefix="/backup", tags=["backup"])

MAX_IMPORT_BYTES = 500 * 1024 * 1024


@router.get("/export")
def export_database():
    """Scarica un dump completo del database in formato pg_dump custom."""
    from app.services.db_backup import export_dump, suggest_filename
    from fastapi.responses import StreamingResponse

    try:
        proc = export_dump()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Impossibile avviare pg_dump: {e}")

    def stream():
        try:
            yield from proc.stdout
            proc.stdout.close()
            ret = proc.wait()
            if ret != 0:
                stderr = proc.stderr.read().decode("utf-8", errors="replace")[:2000]
                _LOG.error("pg_dump exit %d: %s", ret, stderr)
        finally:
            proc.stderr.close()

    filename = suggest_filename()
    return StreamingResponse(
        stream(),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import")
def import_database(file: UploadFile = File(...)):
    """Importa un dump pg_dump custom (.dump) nel database, sovrascrivendo i dati esistenti."""
    if not file.filename or not file.filename.lower().endswith(".dump"):
        raise HTTPException(
            status_code=400,
            detail="Il file deve avere estensione .dump (formato pg_dump custom)",
        )

    from app.services.db_backup import import_dump

    try:
        contents = read_upload_limited(file, max_bytes=MAX_IMPORT_BYTES)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Errore lettura file: {e}")

    try:
        msg = import_dump(contents)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Errore durante import: {e}")
    finally:
        try:
            file.file.close()
        except Exception:
            pass

    return {"detail": msg}
