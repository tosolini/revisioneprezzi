"""Risoluzione CPV → associazione Tabella D (Allegato II.2-bis).

Implementa l'Art. 11, commi 2-4: match esatto su Tabelle D.1/D.2/D.3, walk-up
sul CPV con livello di disaggregazione inferiore (Art. 11.2d) e fallback
Art. 11.4 per i CPV non elencati.

Cifra di controllo: l'algoritmo EU (mod 11, pesi 2-8 sulle prime 7 cifre) NON
si verifica sulle coppie note del file sorgente (50330000-7, 90910000-9,
50300000-8, 03100000-2) — verificato sui dati. Quindi il walk-up cerca i
troncamenti per base esatta sulla tabella master, senza ricalcolo del check
digit (modalità alternativa prevista nel piano).
"""

import re

from sqlalchemy.orm import Session

from app.models.index_observation import IndexObservation
from app.models.index_series import IndexSeries
from app.models.tabella_d import CpvTabellaDAssociation, CpvTabellaDMaster

# --- Sequenze di verifica della cifra di controllo (coppie note dal file) ---
_CHECK_DIGIT_PAIRS = ("50330000-7", "90910000-9", "50300000-8", "03100000-2")


def _eu_check_digit(code8: str) -> int:
    digits = [int(d) for d in code8[:7]]
    total = sum(d * w for d, w in zip(digits, (2, 3, 4, 5, 6, 7, 8)))
    check = (11 - total % 11) % 11
    return 0 if check == 10 else check


def _check_digit_valid() -> bool:
    for pair in _CHECK_DIGIT_PAIRS:
        body, expected = pair.split("-")
        if _eu_check_digit(body) != int(expected):
            return False
    return True


CHECK_DIGIT_VALID = _check_digit_valid()

# --- Mappa statica PPS → serie ISTAT_PS_BTOB (Tabella D punti 1 e 7) ---
# La mappa è completata sui codici PPS presenti in D.2/D.3; i codici senza
# corrispondenza usano il totale BtoB. Fonte: associazioni Tabella D e serie
# BtoB disponibili per nome.
PPS_SERIES_MAP = {
    "494": "ISTAT_PS_BTOB_TRASP",  # Trasporto di merci su strada e trasloco
    "81": "ISTAT_PS_BTOB_PUL",  # Attività di servizi per edifici e paesaggio
    "49": "ISTAT_PS_BTOB_TRASP",  # Trasporto terrestre e mediante condotte
    "50": "ISTAT_PS_BTOB_TRASP",  # Trasporto marittimo e per vie d'acqua
    "511": "ISTAT_PS_BTOB_TRASP",  # Trasporto aereo di passeggeri
    "512": "ISTAT_PS_BTOB_TRASP",  # Trasporto aereo di merci e spaziale
    "521": "ISTAT_PS_BTOB_TRASP",  # Magazzinaggio e custodia
    "522": "ISTAT_PS_BTOB_TRASP",  # Attività di supporto ai trasporti
    "5224": "ISTAT_PS_BTOB_TRASP",  # Movimentazione merci
    "5229": "ISTAT_PS_BTOB_TRASP",  # Altre attività di supporto ai trasporti
    "53": "ISTAT_PS_BTOB_TRASP",  # Servizi postali e attività di corriere
    "61": "ISTAT_PS_BTOB_INFO",  # Telecomunicazioni
    "611": "ISTAT_PS_BTOB_INFO",  # Telecomunicazioni fisse
    "612": "ISTAT_PS_BTOB_INFO",  # Telecomunicazioni mobili
    "62": "ISTAT_PS_BTOB_INFO",  # Produzione software, consulenza informatica
    "631": "ISTAT_PS_BTOB_INFO",  # Elaborazione dati, hosting, portali web
    "639": "ISTAT_PS_BTOB_INFO",  # Altri servizi d'informazione
    "702": "ISTAT_PS_BTOB_PROF",  # Consulenza gestionale
    "71": "ISTAT_PS_BTOB_PROF",  # Studi di architettura e d'ingegneria
    "73": "ISTAT_PS_BTOB_PROF",  # Pubblicità e ricerche di mercato
    "771": "ISTAT_PS_BTOB_SUPP",  # Noleggio di altre macchine e attrezzature
    "773": "ISTAT_PS_BTOB_SUPP",  # Noleggio di altre macchine e beni materiali
    "78": "ISTAT_PS_BTOB_SUPP",  # Ricerca, selezione e fornitura personale
    "79": "ISTAT_PS_BTOB_SUPP",  # Agenzie di viaggio e tour operator
    "80": "ISTAT_PS_BTOB_SUPP",  # Vigilanza e investigazione
    "812": "ISTAT_PS_BTOB_PUL",  # Attività di pulizia e disinfestazione
    "82": "ISTAT_PS_BTOB_SUPP",  # Supporto per funzioni d'ufficio
}
PPS_DEFAULT_SERIES = "ISTAT_PS_BTOB_TOT"

# --- Mappa IR divisione ATECO → lettera sezione (21 righe, nota Tabella D) ---
IR_DIVISION_TO_SECTION = {
    (1, 3): "A",
    (5, 9): "B",
    (10, 33): "C",
    (35, 35): "D",
    (36, 39): "E",
    (41, 43): "F",
    (45, 47): "G",
    (49, 53): "H",
    (55, 56): "I",
    (58, 63): "J",
    (64, 66): "K",
    (68, 68): "L",
    (69, 75): "M",
    (77, 82): "N",
    (84, 84): "O",
    (85, 85): "P",
    (86, 88): "Q",
    (90, 93): "R",
    (94, 96): "S",
    (97, 98): "T",
    (99, 99): "U",
}


def _ir_section_for_division(division: int) -> str | None:
    for (lo, hi), section in IR_DIVISION_TO_SECTION.items():
        if lo <= division <= hi:
            return section
    return None


def normalize_cpv(code: str) -> str:
    """Normalizza un codice CPV: rimuove tutti gli spazi e ricompone la forma
    completa `NNNNNNNN-N` (o `NNNNNNNN` senza cifra di controllo)."""
    code = re.sub(r"\s+", "", code)
    if "-" in code:
        parts = code.split("-", 1)
        code = parts[0] + "-" + parts[1]
    return code


def cpv_base(code: str) -> str:
    """Le sole 8 cifre del codice (senza cifra di controllo)."""
    if "-" in code:
        code = code.split("-")[0]
    return re.sub(r"\D", "", code)


def cpv_parent(code: str) -> str | None:
    """CPV con livello di disaggregazione inferiore: tronca il run
    significativo di una cifra e riempie con zeri. Ritorna la forma completa
    (con check digit ricalcolato) se l'algoritmo EU è verificato, altrimenti
    la base a 8 cifre (lookup esatto sul master)."""
    base = cpv_base(code)
    run = base.rstrip("0")
    if len(run) <= 1:
        return None
    parent_base = run[:-1] + "0" * (8 - len(run[:-1]))
    if CHECK_DIGIT_VALID:
        return f"{parent_base}-{_eu_check_digit(parent_base)}"
    return parent_base


def _series_available(db: Session, series_id: str | None) -> bool:
    if not series_id:
        return False
    series = db.query(IndexSeries).filter(IndexSeries.id == series_id).first()
    if series is None:
        return False
    count = db.query(IndexObservation).filter(IndexObservation.series_id == series_id).count()
    return count > 0


def resolve_series(assoc: dict, db: Session) -> dict:
    """Determina la serie ISTAT per un'associazione Tabella D.

    Ritorna `{series_id, available}`; `series_id` None se nessuna serie
    corrisponde, `available` False se la serie esiste senza osservazioni.
    """
    index_type = assoc["index_type"]
    code = assoc["ateco_code"]

    if index_type == "PC":
        candidates = [
            f"ISTAT_NIC_ECOICOP2_{code}%",
            "ISTAT_NIC_ECOICOP2_00ST%",
            "ISTAT_NIC_ECOICOP2_00%",
        ]
        series_id = None
        for pattern in candidates:
            rows = (
                db.query(IndexSeries)
                .filter(IndexSeries.id.like(pattern))
                .order_by(IndexSeries.id.desc())
                .all()
            )
            if rows:
                series_id = max(rows, key=lambda r: len(r.id)).id
                break
    elif index_type == "PPI":
        for suffix in ("_D", "_T"):
            candidate = f"ISTAT_PPI_{code}{suffix}"
            if db.query(IndexSeries).filter(IndexSeries.id == candidate).first():
                series_id = candidate
                break
        else:
            series_id = None
    elif index_type == "PPS":
        series_id = PPS_SERIES_MAP.get(code, PPS_DEFAULT_SERIES)
    elif index_type == "IR":
        if code.isalpha() and len(code) == 1:
            series_id = f"ISTAT_RCO_SETT_{code}"
        else:
            # Prefer granular wages_ateco monthly series
            # (es. 61 → ISTAT_WAGES_ATECO_61) se disponibile con dati;
            # fallback a RCO sezione (J per 61, S per 95.1) per compat.
            normalized = code.strip().replace(".", "").replace(" ", "")
            candidates: list[str] = []
            if normalized:
                candidates.append(f"ISTAT_WAGES_ATECO_{normalized}")
                raw = code.strip()
                if raw != normalized:
                    candidates.append(f"ISTAT_WAGES_ATECO_{raw}")
            div2 = (
                normalized[:2]
                if len(normalized) >= 2 and normalized[:2].isdigit()
                else (code[:2] if code[:2].isdigit() else None)
            )
            if div2 and f"ISTAT_WAGES_ATECO_{div2}" not in candidates:
                candidates.append(f"ISTAT_WAGES_ATECO_{div2}")
            series_id = None
            for cand in candidates:
                if _series_available(db, cand):
                    series_id = cand
                    break
            if series_id is None:
                division = int(code[:2]) if code[:2].isdigit() else None
                section = _ir_section_for_division(division) if division is not None else None
                series_id = f"ISTAT_RCO_SETT_{section}" if section else None
    else:
        series_id = None
    available = _series_available(db, series_id)
    return {"series_id": series_id, "available": available}


def resolve_associations(cpv: str, db: Session) -> dict | None:
    """Risolve un CPV verso l'associazione Tabella D.

    Ritorna `{cpv_code, resolved_cpv_code, table_class, associations}` oppure
    None se il CPV non è in Tabella D (ramo Art. 11.4).
    """
    code = normalize_cpv(cpv)
    if not code:
        return None

    # 1. Match esatto
    exact = (
        db.query(CpvTabellaDAssociation)
        .filter(CpvTabellaDAssociation.cpv_code == code)
        .order_by(CpvTabellaDAssociation.position)
        .all()
    )
    if exact:
        rows = exact
        resolved_code = code
        table_class = rows[0].table_class
    else:
        # 2. Walk-up: CPV con livello di disaggregazione inferiore (Art. 11.2d)
        rows = None
        resolved_code = None
        table_class = None
        parent = cpv_parent(code)
        while parent:
            master_row = None
            if CHECK_DIGIT_VALID:
                master_row = (
                    db.query(CpvTabellaDMaster).filter(CpvTabellaDMaster.cpv_code == parent).first()
                )
            else:
                parent_base = cpv_base(parent)
                master_row = (
                    db.query(CpvTabellaDMaster)
                    .filter(
                        CpvTabellaDMaster.table_class.in_(("D1", "D2", "D3")),
                    )
                    .all()
                )
                master_row = next(
                    (m for m in master_row if cpv_base(m.cpv_code) == parent_base),
                    None,
                )

            if master_row is None or master_row.table_class == "CHILDREN":
                parent = cpv_parent(parent)
                continue

            table_class = master_row.table_class
            resolved_code = master_row.cpv_code
            rows = (
                db.query(CpvTabellaDAssociation)
                .filter(CpvTabellaDAssociation.cpv_code == master_row.cpv_code)
                .order_by(CpvTabellaDAssociation.position)
                .all()
            )
            break

        if rows is None:
            return None

    return {
        "cpv_code": code,
        "resolved_cpv_code": resolved_code,
        "table_class": table_class,
        "associations": [
            {
                "index_type": r.index_type,
                "classification": r.classification,
                "ateco_code": r.ateco_code,
                "description": r.index_description,
            }
            for r in rows
        ],
    }
