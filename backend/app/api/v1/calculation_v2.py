"""
API endpoint per calcolo revisione prezzi v2 (semplificato)
Secondo D.lgs 36/2023 Allegato II.2-bis
"""
from datetime import date
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.revision_calculation_v2 import (
    calculate_multi_component_revision,
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
    components: dict[str, float] = Field(
        ...,
        description="Mappa series_id: peso_percentuale (somma deve essere 100)"
    )


class CalculationRequest(BaseModel):
    """Richiesta calcolo revisione prezzi"""
    contract_type: str = Field(
        ...,
        pattern="^(works|services|supplies)$",
        description="Tipo contratto: works|services|supplies"
    )
    amount: float = Field(..., gt=0, description="Importo assoggettabile a revisione")
    base_period: date = Field(..., description="Periodo base (data aggiudicazione)")
    comparison_period: date = Field(..., description="Periodo confronto (data rilevazione)")
    indices_config: IndicesConfigSingle | IndicesConfigComposite = Field(
        ...,
        discriminator="type",
        description="Configurazione indici (singolo o composito)"
    )


class MultiComponentRequest(BaseModel):
    """Richiesta calcolo multi-componente (Art. 13)"""
    contract_type: str = Field(..., pattern="^(works|services|supplies)$")
    base_period: date
    comparison_period: date
    components: list[dict] = Field(
        ...,
        min_length=2,
        description="Lista componenti con amount, indices_config, description"
    )


@router.post("/calculate")
def calculate(
    request: CalculationRequest,
    db: Session = Depends(get_db)
) -> dict:
    """
    Calcola revisione prezzi secondo schema semplificato v2
    
    Parametri normativi applicati automaticamente:
    - Lavori: soglia 3%, coefficiente 90%
    - Servizi/Forniture: soglia 5%, coefficiente 80%
    
    Returns:
        Risultato calcolo con tutti i passaggi, soglia superata, importo revisionale
    """
    try:
        # Prepara config indici
        if request.indices_config.type == "single":
            indices_config = {
                "type": "single",
                "single_series_id": request.indices_config.single_series_id
            }
        else:
            indices_config = {
                "type": "composite",
                "components": request.indices_config.components
            }
        
        result = calculate_price_revision(
            db=db,
            contract_type=request.contract_type,
            amount=request.amount,
            base_period=request.base_period,
            comparison_period=request.comparison_period,
            indices_config=indices_config
        )
        
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        
        return result
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Errore calcolo: {str(e)}")


@router.post("/calculate/multi-component")
def calculate_multi_component(
    request: MultiComponentRequest,
    db: Session = Depends(get_db)
) -> dict:
    """
    Calcola revisione per contratti multi-componente (Art. 13)
    
    Applicabile a contratti con prestazioni di natura diversa (CPV diversi)
    La clausola si attiva solo se la variazione complessiva supera la soglia
    """
    try:
        result = calculate_multi_component_revision(
            db=db,
            contract_type=request.contract_type,
            components=request.components,
            base_period=request.base_period,
            comparison_period=request.comparison_period
        )
        
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        
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
            detail=f"Tipo contratto non valido. Valori ammessi: works, services, supplies"
        )
    
    return NORMATIVE_PARAMS[contract_type]


@router.post("/preview")
def preview_calculation(
    request: CalculationRequest,
    db: Session = Depends(get_db)
) -> dict:
    """
    Anteprima calcolo senza salvare
    Alias di /calculate, utile per separare preview da esecuzione definitiva
    """
    return calculate(request, db)
