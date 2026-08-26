"""Import Tabella D (Allegato II.2-bis D.lgs 36/2023): master CPV→tabella e
associazioni CPV→indici ISTAT (Tabelle D.1/D.2/D.3).

Senza `--apply` genera/aggiorna solo i CSV seed (`backend/seeds/cpv_tabella_d.csv`).
Con `--apply` scrive anche nel database (upsert).

Uso:
    python scripts/import_tabella_d.py [--apply] [--source PATH]
"""

import argparse
import csv
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

DEFAULT_SOURCE = (
    Path(__file__).resolve().parent.parent.parent
    / "source"
    / "Allegato II.2-bis Modalità applicative delle clausole di revisione dei prezzi (DLGS_36_2023).md"  # noqa: E501
)
SEEDS_DIR = Path(__file__).resolve().parent.parent / "seeds"

SEP_CELLS = ("", "---", "-")
INDEX_CELL_RE = re.compile(r"\[([^\]]+)\]\s*([^;\\[]*)")


def normalize_cpv(code: str) -> str:
    """Normalizza un codice CPV: rimuove tutti gli spazi e ricompone la forma
    completa `NNNNNNNN-N` (o `NNNNNNNN` se il sorgente non ha la cifra di
    controllo). La cifra di controllo non viene ricalcolata: nel file sorgente
    non segue l'algoritmo EU (verificato sulle coppie note)."""
    code = re.sub(r"\s+", "", code)
    if "-" in code:
        parts = code.split("-", 1)
        code = parts[0] + "-" + parts[1]
    return code


def cpv_base(code: str) -> str:
    """Solo le 8 cifre del codice (senza cifra di controllo)."""
    if "-" in code:
        code = code.split("-")[0]
    return re.sub(r"\D", "", code)


def _find_line(lines: list[str], pattern: str, start: int = 0) -> int | None:
    for i in range(start, len(lines)):
        if re.search(pattern, lines[i]):
            return i
    return None


def _table_rows(lines: list[str], start_idx: int, end_idx: int) -> list[list[str]]:
    """Righe di una tabella markdown, ricomponendo le righe spezzate su
    più linee (descrizioni lunghe) e saltando le righe separatore."""
    rows: list[list[str]] = []
    current: list[str] | None = None
    for i in range(start_idx, end_idx):
        line = lines[i].strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if all(c in SEP_CELLS for c in cells):
            continue
        if re.match(r"^\d", cells[0]):
            if current is not None:
                rows.append(current)
            current = cells
        elif current is not None:
            current[-1] = (current[-1] + " " + " ".join(cells)).strip()
    if current is not None:
        rows.append(current)
    return rows


def _parse_index_cell(cell: str) -> list[tuple[str, str]]:
    """Estrae i codici `[..]` da una cella indice; la stessa cella puo
    contenerne piu di uno separati da spazio o `;`. I codici possono
    avere spazi interni (es. `[23 3]`) o underscore escape (es. `691_692-702`)."""
    out = []
    for m in INDEX_CELL_RE.finditer(cell):
        raw = re.sub(r"\s+", "", m.group(1)).replace("\\_", "_")
        if raw.upper().startswith("NB"):
            continue
        desc = m.group(2).strip()
        out.append((raw, desc))
    return out


def _classification(index_type: str) -> str:
    return "ECOICOP" if index_type == "PC" else "ATECO"


def _row_associations(row: list[str], table_class: str) -> list[dict]:
    """Associazioni di una riga D.1 (1 slot) o D.2/D.3 (3 slot)."""
    code = normalize_cpv(row[0])
    assoc = []
    if table_class == "D1":
        tipo = row[2] if len(row) > 2 else ""
        cell = row[3] if len(row) > 3 else ""
        if not tipo:
            return assoc
        for i, (ateco, desc) in enumerate(_parse_index_cell(cell)):
            assoc.append({
                "cpv_code": code,
                "table_class": table_class,
                "position": 10 + i,
                "index_type": tipo,
                "classification": _classification(tipo),
                "ateco_code": ateco,
                "index_description": desc,
            })
        return assoc
    # D.2 / D.3: 3 slot (tipo, indice)
    for slot in range(3):
        tipo_i = 2 + slot * 2
        cell_i = 3 + slot * 2
        if tipo_i >= len(row) or cell_i >= len(row):
            continue
        tipo = row[tipo_i].strip()
        if not tipo:
            continue
        for j, (ateco, desc) in enumerate(_parse_index_cell(row[cell_i])):
            assoc.append({
                "cpv_code": code,
                "table_class": table_class,
                "position": slot * 10 + j + 1,
                "index_type": tipo,
                "classification": _classification(tipo),
                "ateco_code": ateco,
                "index_description": desc,
            })
    return assoc


def parse_source(path: Path) -> tuple[list[dict], list[dict]]:
    """Parsing del file sorgente. Ritorna (master, associations)."""
    lines = path.read_text(encoding="utf-8").splitlines()
    i_master = _find_line(lines, r"ELENCO CPV E TABELLE DI PERTINENZA")
    i_d1 = _find_line(lines, r"Tabella D1")
    i_d2 = _find_line(lines, r"TABELLA D2")
    i_d3 = _find_line(lines, r"TABELLA D3")
    if i_master is None or i_d1 is None or i_d2 is None or i_d3 is None:
        raise ValueError(f"Sezioni Tabella D non trovate in {path}")

    master = []
    for row in _table_rows(lines, i_master + 1, i_d1):
        code = normalize_cpv(row[0])
        table_class = row[2] if len(row) > 2 else ""
        if "maggior dettaglio" in table_class:
            table_class = "CHILDREN"
        if code:
            master.append({
                "cpv_code": code,
                "cpv_description": row[1] if len(row) > 1 else "",
                "table_class": table_class,
            })

    associations = []
    for section, start, end in (
        ("D1", i_d1 + 1, i_d2),
        ("D2", i_d2 + 1, i_d3),
        ("D3", i_d3 + 1, len(lines)),
    ):
        for row in _table_rows(lines, start, end):
            associations.extend(_row_associations(row, section))

    return master, associations


def write_seeds(master: list[dict], associations: list[dict], out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    master_path = out_dir / "cpv_tabella_d.csv"
    with master_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["cpv_code", "cpv_description", "table_class"])
        writer.writeheader()
        for m in master:
            writer.writerow(m)
    assoc_path = out_dir / "cpv_tabella_d_association.csv"
    with assoc_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "cpv_code", "table_class", "position", "index_type",
            "classification", "ateco_code", "index_description",
        ])
        writer.writeheader()
        for a in associations:
            writer.writerow(a)
    print(f"OK: seed CSV scritti in {out_dir} "
          f"({len(master)} master, {len(associations)} associazioni)")


def apply_to_db(db, master: list[dict], associations: list[dict]) -> None:
    from app.models.tabella_d import CpvTabellaDAssociation, CpvTabellaDMaster

    # Upsert master
    inserted = updated = 0
    for m in master:
        existing = db.query(CpvTabellaDMaster).filter_by(cpv_code=m["cpv_code"]).first()
        if existing:
            if (
                existing.cpv_description != m["cpv_description"]
                or existing.table_class != m["table_class"]
            ):
                existing.cpv_description = m["cpv_description"]
                existing.table_class = m["table_class"]
                updated += 1
        else:
            db.add(CpvTabellaDMaster(**m))
            inserted += 1

    # Associazioni: delete + insert (le tabelle D sono rigenerate dal sorgente)
    db.query(CpvTabellaDAssociation).delete()
    for a in associations:
        db.add(CpvTabellaDAssociation(**a))
    db.commit()
    print(f"OK: DB aggiornato ({inserted} nuovi master, {updated} aggiornati, "
          f"{len(associations)} associazioni)")


def main() -> None:
    parser = argparse.ArgumentParser(description="Import Tabella D (Allegato II.2-bis)")
    parser.add_argument("--apply", action="store_true", help="scrivi anche nel DB")
    parser.add_argument(
        "--source", type=Path, default=DEFAULT_SOURCE, help="percorso file sorgente"
    )
    args = parser.parse_args()

    if not args.source.exists():
        print(f"ERRORE: file sorgente non trovato: {args.source}", file=sys.stderr)
        sys.exit(1)

    master, associations = parse_source(args.source)
    write_seeds(master, associations, SEEDS_DIR)

    if args.apply:
        from app.core.database import SessionLocal

        db = SessionLocal()
        try:
            apply_to_db(db, master, associations)
        finally:
            db.close()


if __name__ == "__main__":
    main()
