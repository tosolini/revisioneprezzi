import os
import subprocess
import tempfile
from datetime import datetime

from app.core.config import settings


def _parse_db_url() -> dict:
    url = settings.database_url
    rest = url
    if rest.startswith("postgresql://"):
        rest = rest[len("postgresql://"):]
    elif rest.startswith("postgres://"):
        rest = rest[len("postgres://"):]
    else:
        raise ValueError(f"Unsupported DATABASE_URL scheme: {url}")

    user_pass, host_part = rest.split("@", 1)
    user, password = user_pass.split(":", 1) if ":" in user_pass else (user_pass, "")
    host_port, dbname = host_part.rsplit("/", 1)
    host, port = host_port.split(":", 1) if ":" in host_port else (host_port, "5432")

    return {
        "host": host,
        "port": port,
        "user": user,
        "password": password,
        "dbname": dbname,
    }


def _pg_args(db_info: dict) -> list[str]:
    return [
        "--host", db_info["host"],
        "--port", db_info["port"],
        "--username", db_info["user"],
        "--dbname", db_info["dbname"],
    ]


def export_dump() -> subprocess.Popen:
    db = _parse_db_url()
    env = os.environ.copy()
    if db["password"]:
        env["PGPASSWORD"] = db["password"]

    args = ["pg_dump", "--format=custom", "--no-owner", "--no-acl"] + _pg_args(db)
    proc = subprocess.Popen(
        args,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )
    return proc


def import_dump(dump_bytes: bytes) -> str:
    db = _parse_db_url()
    env = os.environ.copy()
    if db["password"]:
        env["PGPASSWORD"] = db["password"]

    with tempfile.NamedTemporaryFile(suffix=".dump", delete=False) as tmp:
        tmp.write(dump_bytes)
        tmp_path = tmp.name

    try:
        args = ["pg_restore", "--clean", "--if-exists", "--no-owner", "--no-acl"] + _pg_args(db) + [tmp_path]
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            env=env,
            timeout=300,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"pg_restore failed (exit {result.returncode}):\n{result.stderr[:2000]}"
            )
        return result.stderr.strip() or "Import completato con successo"
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def suggest_filename() -> str:
    now = datetime.now().strftime("%Y-%m-%d_%H%M")
    return f"revisione_prezzi_{now}.dump"
