"""Servizio di raccordo indici su basi storiche contigue (IndexBaseLink).

Gestisce il passaggio tra basi ISTAT (es. Base 2015=100 -> Base 2025=100 per NIC/PC ex Reg. UE 2025/1182)
quando un contratto pubblico ha periodo base e periodo di confronto su basi di riferimento diverse.
"""

from dataclasses import dataclass
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from app.models.index_base_link import IndexBaseLink


@dataclass
class BaseLinkInfo:
    applied: bool
    coefficient: float = 1.0
    reference_period: date | None = None
    source: str | None = None
    note: str | None = None
    homogenized_comp_value: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "applied": self.applied,
            "coefficient": self.coefficient if self.applied else None,
            "reference_period": self.reference_period.isoformat() if self.reference_period else None,
            "source": self.source if self.applied else None,
            "note": self.note if self.applied else None,
            "homogenized_comp_value": self.homogenized_comp_value if self.applied else None,
        }


def _find_link_for_series(db: Session, series_id: str) -> IndexBaseLink | None:
    """Cerca il link di raccordo per la serie, con fallback gerarchico per codici ECOICOP."""
    link = (
        db.query(IndexBaseLink)
        .filter(
            (IndexBaseLink.from_series_id == series_id) | (IndexBaseLink.to_series_id == series_id)
        )
        .first()
    )
    if link:
        return link

    # Se serie NIC ECOICOP 2 (es. ISTAT_NIC_ECOICOP2_105091), prova a risalire ai prefissi padre
    prefix = "ISTAT_NIC_ECOICOP2_"
    if series_id.startswith(prefix):
        code = series_id.removeprefix(prefix)
        # prova prefissi decrescenti: es. 10509 -> 1050 -> 105 -> 10 -> 00
        for length in range(len(code) - 1, 1, -1):
            parent_id = f"{prefix}{code[:length]}"
            link = db.query(IndexBaseLink).filter_by(from_series_id=parent_id).first()
            if link:
                return link
        # fallback all'indice generale NIC 00
        return db.query(IndexBaseLink).filter_by(from_series_id=f"{prefix}00").first()

    if "NIC" in series_id:
        return db.query(IndexBaseLink).filter_by(from_series_id="ISTAT_NIC_GEN").first()

    return None


def resolve_base_link(
    db: Session,
    series_id: str,
    base_period: date,
    comparison_period: date,
    comp_value: float | None = None,
) -> BaseLinkInfo:
    """Verifica se per la serie e l'intervallo temporale si attraversa un cambio base ISTAT.

    Se l'intervallo attraversa reference_period (es. base_period < 2026-01-01 <= comparison_period),
    applica il coefficiente di raccordo ufficiale per omogeneizzare il valore di confronto.
    """
    if not series_id:
        return BaseLinkInfo(applied=False)

    link = _find_link_for_series(db, series_id)
    if not link:
        return BaseLinkInfo(applied=False)

    ref = link.reference_period
    coeff = float(link.coefficient)

    # Caso ordinario T0 < ref <= T1 (es. base in 2025, confronto in 2026)
    if base_period < ref <= comparison_period:
        homog_comp = round(comp_value * coeff, 4) if comp_value is not None else None
        note = (
            f"Applicato coefficiente di raccordo ISTAT base 2015 -> 2025 pari a {coeff:.4f} "
            f"(Reg. UE 2025/1182) sul valore di confronto ({comp_value} -> {homog_comp})."
        )
        return BaseLinkInfo(
            applied=True,
            coefficient=coeff,
            reference_period=ref,
            source=link.source,
            note=note,
            homogenized_comp_value=homog_comp,
        )

    # Caso inverso (se mai richiesto): T1 < ref <= T0
    if comparison_period < ref <= base_period:
        # Nel caso inverso, comp_value è nella vecchia base e base_value è nella nuova
        homog_comp = round(comp_value / coeff, 4) if comp_value is not None else None
        note = (
            f"Applicato coefficiente inverso di raccordo ISTAT ({coeff:.4f}) "
            f"sul periodo di confronto."
        )
        return BaseLinkInfo(
            applied=True,
            coefficient=coeff,
            reference_period=ref,
            source=link.source,
            note=note,
            homogenized_comp_value=homog_comp,
        )

    return BaseLinkInfo(applied=False)
