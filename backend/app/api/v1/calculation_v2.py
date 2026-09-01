"""
API endpoint per calcolo revisione prezzi v2 (semplificato)
Secondo D.lgs 36/2023 Allegato II.2-bis
"""

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.index_import_query import IndexImportQuery, IndexImportQuerySeries
from app.services.revision_calculation_v2 import (
    calculate_multi_component_revision,
    calculate_period_coverage,
    calculate_price_revision,
)

router = APIRouter(prefix="/calculation/v2", tags=["calculation-v2"])


# Request/Response Models
class IndicesConfigSingle(BaseModel):
    """Configurazione indice singolo"""

    type: Literal["single"] = "single"
    single_series_id: str = Field(..., description="ID serie ISTAT/MIT")


class IndicesConfigComposite(BaseModel):
    """Configurazione indice composito (multi-TOL o multi-indice CPV)"""

    type: Literal["composite"] = "composite"
    method: Literal["weighted_values", "weighted_variations"] = "weighted_values"
    components: dict[str, float] = Field(
        ..., description="Mappa series_id: peso_percentuale (somma deve essere 100)"
    )


class CalculationRequest(BaseModel):
    """Richiesta calcolo revisione prezzi"""

    contract_type: str = Field(
        ...,
        pattern="^(works|services|supplies)$",
        description="Tipo contratto: works|services|supplies",
    )
    amount: float = Field(..., gt=0, description="Importo assoggettabile a revisione")
    base_period: date = Field(..., description="Periodo base (data aggiudicazione)")
    comparison_period: date = Field(..., description="Periodo confronto (data rilevazione)")
    indices_config: IndicesConfigSingle | IndicesConfigComposite = Field(
        ..., discriminator="type", description="Configurazione indici (singolo o composito)"
    )
    force_inverted_periods: bool = Field(
        default=False,
        description=(
            "Override riservato (nessun controllo UI): consente base successivo "
            "al confronto. Da non esporre; per soli allineamenti puntuali."
        ),
    )


class MultiComponentRequest(BaseModel):
    """Richiesta calcolo multi-componente (Art. 13)"""

    contract_type: str = Field(..., pattern="^(works|services|supplies)$")
    base_period: date
    comparison_period: date
    components: list[dict] = Field(
        ..., min_length=2, description="Lista componenti con amount, indices_config, description"
    )
    force_inverted_periods: bool = Field(
        default=False,
        description=(
            "Override riservato (nessun controllo UI): consente base successivo "
            "al confronto. Da non esporre; per soli allineamenti puntuali."
        ),
    )


def _raise_inverted_periods(base_period: date, comparison_period: date) -> None:
    """Blocca l'inversione base/confronto: invertire cambierebbe il segno della
    variazione (un aumento diventerebbe una decurtazione)."""
    if base_period > comparison_period:
        raise HTTPException(
            422,
            "Il periodo base (data aggiudicazione) deve essere antecedente o "
            "uguale al periodo di confronto (data rilevazione): con il base "
            "posteriore al confronto la variazione risulterebbe col segno "
            "invertito. Correggi i periodi prima di calcolare.",
        )


def _check_period_order(base_period: date, comparison_period: date, force: bool) -> None:
    if not force:
        _raise_inverted_periods(base_period, comparison_period)


class CoverageRequest(BaseModel):
    """Richiesta verifica copertura periodi per le serie componenti."""

    components: dict[str, float] = Field(..., description="Mappa series_id: peso_percentuale")
    base_period: date
    comparison_period: date


@router.post("/coverage")
def period_coverage(request: CoverageRequest, db: Session = Depends(get_db)) -> dict:
    """Copertura dei periodi richiesti per ciascuna serie componente.

    Indica, per ogni serie, l'osservazione che il calcolo utilizzerebbe per
    il periodo base e di confronto (periodo usato, valore, esattezza rispetto
    al periodo richiesto) così l'utente può capire se i periodi che sta
    cercando di confrontare esistono o vengono soddisfatti per fallback.
    Arricchita con `saved_query` per offrire ⟳ Ricarica dati quando il periodo
    non ha dati sufficienti ma esiste una query SDMX salvata.
    """
    coverage = calculate_period_coverage(
        db, request.components, request.base_period, request.comparison_period
    )
    # Arricchisci con query SDMX salvata più recente per serie (forma breve come in /indices/search)
    try:
        series_ids = list(request.components.keys())
        latest: dict[str, IndexImportQuery] = {}
        if series_ids:
            links = (
                db.query(IndexImportQuerySeries, IndexImportQuery)
                .join(IndexImportQuery, IndexImportQuerySeries.query_id == IndexImportQuery.id)
                .filter(IndexImportQuerySeries.series_id.in_(series_ids))
                .order_by(IndexImportQuery.created_at.desc(), IndexImportQuery.last_run_at.desc())
                .all()
            )
            for link, q in links:
                latest.setdefault(link.series_id, q)
        for entry in coverage:
            sid = entry.get("series_id")
            q = latest.get(sid) if isinstance(sid, str) else None
            if q is not None:
                entry["saved_query"] = {
                    "id": str(q.id),
                    "url": q.url,
                    "dataflow_id": q.dataflow_id,
                    "key_part": q.key_part,
                    "end_period_strategy": getattr(q, "end_period_strategy", "last_month_end")
                    or "last_month_end",
                    "start_period_strategy": getattr(q, "start_period_strategy", "fixed")
                    or "fixed",
                    "last_run_at": q.last_run_at.isoformat()
                    if getattr(q, "last_run_at", None)
                    else None,
                }
            else:
                entry["saved_query"] = None
    except Exception:
        # Non bloccare la copertura se la tabella query non esiste o altro errore
        for entry in coverage:
            entry.setdefault("saved_query", None)
    return {
        "base_period": request.base_period.isoformat(),
        "comparison_period": request.comparison_period.isoformat(),
        "series": coverage,
    }


@router.post("/calculate")
def calculate(request: CalculationRequest, db: Session = Depends(get_db)) -> dict:
    """
    Calcola revisione prezzi secondo schema semplificato v2

    Parametri normativi applicati automaticamente:
    - Lavori: soglia 3%, coefficiente 90%
    - Servizi/Forniture: soglia 5%, coefficiente 80%

    Returns:
        Risultato calcolo con tutti i passaggi, soglia superata, importo revisionale
    """
    _check_period_order(
        request.base_period, request.comparison_period, request.force_inverted_periods
    )
    try:
        # Prepara config indici
        if request.indices_config.type == "single":
            indices_config = {
                "type": "single",
                "single_series_id": request.indices_config.single_series_id,
            }
        else:
            indices_config = {
                "type": "composite",
                "method": request.indices_config.method,
                "components": request.indices_config.components,
            }

        result = calculate_price_revision(
            db=db,
            contract_type=request.contract_type,
            amount=request.amount,
            base_period=request.base_period,
            comparison_period=request.comparison_period,
            indices_config=indices_config,
        )

        if "error" in result:
            detail = result["error"]
            for key in ("comparison_errors", "base_errors"):
                if result.get(key):
                    detail = detail + "\n" + "\n".join(result[key])
            raise HTTPException(status_code=400, detail=detail)

        return result

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Errore calcolo: {str(e)}")


@router.post("/calculate/multi-component")
def calculate_multi_component(
    request: MultiComponentRequest, db: Session = Depends(get_db)
) -> dict:
    """
    Calcola revisione per contratti multi-componente (Art. 13)

    Applicabile a contratti con prestazioni di natura diversa (CPV diversi)
    La clausola si attiva solo se la variazione complessiva supera la soglia
    """
    _check_period_order(
        request.base_period, request.comparison_period, request.force_inverted_periods
    )
    try:
        result = calculate_multi_component_revision(
            db=db,
            contract_type=request.contract_type,
            components=request.components,
            base_period=request.base_period,
            comparison_period=request.comparison_period,
        )

        if "error" in result:
            detail = result["error"]
            for key in ("comparison_errors", "base_errors"):
                if result.get(key):
                    detail = detail + "\n" + "\n".join(result[key])
            raise HTTPException(status_code=400, detail=detail)

        return result

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Errore calcolo: {str(e)}")


@router.get("/parameters/{contract_type}")
def get_normative_parameters(contract_type: str) -> dict:
    """
    Ritorna i parametri normativi per un tipo di contratto

    Path params:
    - contract_type: works|services|supplies

    Returns:
        threshold_percent, recognition_rate_percent, reference
    """
    from app.services.revision_calculation_v2 import NORMATIVE_PARAMS

    if contract_type not in NORMATIVE_PARAMS:
        raise HTTPException(
            status_code=400,
            detail="Tipo contratto non valido. Valori ammessi: works, services, supplies",
        )

    return NORMATIVE_PARAMS[contract_type]


@router.post("/preview")
def preview_calculation(request: CalculationRequest, db: Session = Depends(get_db)) -> dict:
    """
    Anteprima calcolo senza salvare
    Alias di /calculate, utile per separare preview da esecuzione definitiva
    """
    return calculate(request, db)
