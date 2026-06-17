"""Helpers for safely handling uploaded files.

Reading an UploadFile in full with ``file.file.read()`` is unbounded: a client
can stream an arbitrarily large body and exhaust server memory (DoS). These
helpers enforce a maximum size while reading in chunks.
"""

from fastapi import HTTPException, UploadFile

# 20 MiB default cap. Mirrors nginx ``client_max_body_size 20M``.
MAX_UPLOAD_BYTES = 20 * 1024 * 1024

_CHUNK_SIZE = 1024 * 1024  # 1 MiB


def read_upload_limited(file: UploadFile, max_bytes: int = MAX_UPLOAD_BYTES) -> bytes:
    """Read an UploadFile into memory, rejecting bodies larger than ``max_bytes``.

    Raises HTTP 413 if the limit is exceeded.
    """
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = file.file.read(_CHUNK_SIZE)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"File troppo grande (limite {max_bytes // (1024 * 1024)} MB)",
            )
        chunks.append(chunk)
    return b"".join(chunks)

