"""
Servizio di calcolo revisione prezzi semplificato secondo D.lgs 36/2023 Allegato II.2-bis
Supporta sia LAVORI (TOL) che SERVIZI/FORNITURE (CPV)
"""
import json
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, getcontext
from typing import Any, Literal

from sqlalchemy.orm import Session

from app.models.index_observation import IndexObservation

getcontext().prec = 28

ContractType = Literal["works", "services", "supplies"]


# Parametri normativi secondo Art. 3, comma 2-3
NORMATIVE_PARAMS = {
    "works": {
        "threshold_percent": 3.0,
        "recognition_rate_percent": 90.0,
        "reference": "Art. 3 comma 2-3, Allegato II.2-bis - Lavori"
    },
    "services": {
        "threshold_percent": 5.0,
        "recognition_rate_percent": 80.0,
        "reference": "Art. 3 comma 2-3, Allegato II.2-bis - Servizi"
    },
    "supplies": {
        "threshold_percent": 5.0,
        "recognition_rate_percent": 80.0,
        "reference": "Art. 3 comma 2-3, Allegato II.2-bis - Forniture"
    }
}


def _round(val: float, decimals: int = 2) -> float:
    """Arrotonda un valore con precisione specificata"""
    d = Decimal(str(val)).quantize(Decimal(10) ** -decimals, rounding=ROUND_HALF_UP)
    return float(d)


def _get_index_value(db: Session, series_id: str, period: date) -> float | None:
    """Recupera valore indice ISTAT per serie e periodo specifico"""
    obs = (
        db.query(IndexObservation)
        .filter(
            IndexObservation.series_id == series_id,
            IndexObservation.ref_period == period,
            IndexObservation.is_definitive.is_(True),
        )
        .first()
    )
    if obs:
        return obs.value

    before = (
        db.query(IndexObservation)
        .filter(
            IndexObservation.series_id == series_id,
            IndexObservation.ref_period <= period,
            IndexObservation.is_definitive.is_(True),
        )
        .order_by(IndexObservation.ref_period.desc())
        .first()
    )
    if before:
        return before.value

    after = (
        db.query(IndexObservation)
        .filter(
            IndexObservation.series_id == series_id,
            IndexObservation.ref_period >= period,
            IndexObservation.is_definitive.is_(True),
        )
        .order_by(IndexObservation.ref_period.asc())
        .first()
    )
    return after.value if after else None


def calculate_synthetic_index(
    db: Session,
    indices: dict[str, float],  # {series_id: weight_percent}
    period: date
) -> tuple[float | None, list[str]]:
    """
    Calcola indice sintetico ponderato (per LAVORI multi-TOL o SERVIZI/FORNITURE multi-indice)
    
    Formula: Is = Σ(pi × ITOLi) dove pi è il peso percentuale
    
    Returns:
        (indice_sintetico, errori)
    """
    total_weight = sum(indices.values())
    if abs(total_weight - 100.0) > 0.01:
        return None, [f"I pesi devono sommarsi a 100% (attuale: {total_weight}%)"]
    
    errors = []
    synthetic = 0.0
    
    for series_id, weight in indices.items():
        value = _get_index_value(db, series_id, period)
        if value is None:
            errors.append(f"Indice {series_id} non trovato per {period}")
            continue
        synthetic += (weight / 100.0) * value
    
    if errors:
        return None, errors
    
    return _round(synthetic, 4), []


def calculate_price_revision(
    db: Session,
    contract_type: ContractType,
    amount: float,
    base_period: date,
    comparison_period: date,
    indices_config: dict[str, Any],  # Configurazione indici (singolo o multiplo)
) -> dict[str, Any]:
    """
    Calcola revisione prezzi secondo il nuovo schema semplificato
    
    Args:
        contract_type: 'works', 'services' o 'supplies'
        amount: importo assoggettabile a revisione
        base_period: periodo di riferimento (data aggiudicazione)
        comparison_period: periodo di confronto (data rilevazione)
        indices_config: {
            'type': 'single' | 'composite',
            'single_series_id': str (se type='single'),
            'components': {series_id: weight_percent} (se type='composite')
        }
    
    Returns:
        Dizionario con risultato calcolo completo
    """
    # 1. Determina parametri normativi
    params = NORMATIVE_PARAMS[contract_type]
    threshold = params["threshold_percent"]
    coefficient = params["recognition_rate_percent"]
    
    steps = []
    steps.append({
        "step": 0,
        "description": "Parametri normativi applicabili",
        "details": {
            "tipo_contratto": contract_type,
            "soglia_attivazione": f"{threshold}%",
            "coefficiente_riconoscimento": f"{coefficient}%",
            "riferimento": params["reference"]
        },
        "result": f"Soglia {threshold}%, Coefficiente {coefficient}%"
    })
    
    # 2. Calcola indici base e confronto
    index_type = indices_config.get("type", "single")
    
    if index_type == "single":
        series_id = indices_config["single_series_id"]
        base_value = _get_index_value(db, series_id, base_period)
        comp_value = _get_index_value(db, series_id, comparison_period)
        
        if base_value is None or comp_value is None:
            missing_parts = []
            if base_value is None:
                missing_parts.append(f" Periodo base: {base_period}")
            if comp_value is None:
                missing_parts.append(f" Periodo di confronto: {comparison_period}")
            return {
                "error": (
                    "La serie ISTAT selezionata non contiene dati definitivi per i periodi richiesti.\n"
                    "\n"
                    "Dati mancanti:"
                    f"{''.join(missing_parts)}"
                    f"\nSerie ISTAT: {series_id}\n"
                    "\n"
                    "Possibili cause:\n"
                    "• Il periodo non è coperto dalla serie selezionata\n"
                    "• Il dato esiste ma è provvisorio (non ancora certificato ISTAT)\n"
                    "• La data inserita non corrisponde al formato atteso (AAAA-MM-01)\n"
                    "\n"
                    "Cosa fare:\n"
                    "• Rivedere il Periodo base e il Periodo di confronto (step 5)\n"
                    "• Scegliere una serie ISTAT diversa (step 4)\n"
                    "• Se il problema persiste, contattare l'amministratore"
                ),
                "series_id": series_id,
                "base_period": base_period.isoformat(),
                "comparison_period": comparison_period.isoformat(),
            }
        
        steps.append({
            "step": 1,
            "description": "Recupero indici ISTAT",
            "details": {
                "serie": series_id,
                "periodo_base": base_period.isoformat(),
                "valore_base": base_value,
                "periodo_confronto": comparison_period.isoformat(),
                "valore_confronto": comp_value
            },
            "result": f"Indice base: {base_value}, Indice confronto: {comp_value}"
        })
    
    else:  # composite
        components = indices_config["components"]
        base_value, base_errors = calculate_synthetic_index(db, components, base_period)
        comp_value, comp_errors = calculate_synthetic_index(db, components, comparison_period)
        
        if base_errors or comp_errors:
            return {
                "error": "Errori nel calcolo indice sintetico",
                "base_errors": base_errors,
                "comparison_errors": comp_errors
            }
        
        steps.append({
            "step": 1,
            "description": "Calcolo indice sintetico ponderato",
            "details": {
                "componenti": components,
                "formula": "Is = Σ(pi × Ii) dove pi è il peso percentuale",
                "periodo_base": base_period.isoformat(),
                "indice_sintetico_base": base_value,
                "periodo_confronto": comparison_period.isoformat(),
                "indice_sintetico_confronto": comp_value
            },
            "result": f"Is base: {base_value}, Is confronto: {comp_value}"
        })
    
    # 3. Calcola variazione percentuale
    variation = ((comp_value - base_value) / base_value) * 100
    variation = _round(variation, 4)
    
    steps.append({
        "step": 2,
        "description": "Calcolo variazione percentuale",
        "formula": f"((I_confronto - I_base) / I_base) × 100",
        "calculation": f"(({comp_value} - {base_value}) / {base_value}) × 100",
        "result": f"{variation}%"
    })
    
    # 4. Verifica superamento soglia
    is_threshold_exceeded = abs(variation) > threshold
    
    steps.append({
        "step": 3,
        "description": "Verifica soglia di attivazione",
        "formula": f"|Variazione%| > Soglia%",
        "calculation": f"|{variation}%| > {threshold}%",
        "result": "SOGLIA SUPERATA" if is_threshold_exceeded else "SOGLIA NON SUPERATA"
    })
    
    if not is_threshold_exceeded:
        return {
            "contract_type": contract_type,
            "indices_config": indices_config,
            "base_value": base_value,
            "comparison_value": comp_value,
            "variation_percent": variation,
            "threshold_percent": threshold,
            "threshold_exceeded": False,
            "excess_percent": 0.0,
            "recognition_percent": coefficient,
            "revision_amount": 0.0,
            "formula_detail": "\n".join(
                f"Passo {s['step']}: {s['description']} — {s['result']}" 
                for s in steps
            ),
            "steps": steps,
            "is_applicable": False,
            "summary": f"Nessuna revisione: variazione {variation}% entro soglia {threshold}%"
        }
    
    # 5. Calcola eccedenza rispetto alla soglia
    # Mantiene il segno della variazione (positivo = aumento, negativo = diminuzione)
    if variation > 0:
        excess = variation - threshold
    else:
        excess = variation + threshold
    
    excess = _round(excess, 4)
    
    steps.append({
        "step": 4,
        "description": "Calcolo quota eccedente la soglia",
        "formula": "Variazione% - Soglia% (se positiva) o Variazione% + Soglia% (se negativa)",
        "calculation": f"{variation}% {'−' if variation > 0 else '+'} {threshold}% = {excess}%",
        "result": f"Eccedenza: {excess}%"
    })
    
    # 6. Applicazione coefficiente di riconoscimento
    revision_amount = amount * (excess / 100.0) * (coefficient / 100.0)
    revision_amount = _round(revision_amount, 2)
    
    steps.append({
        "step": 5,
        "description": "Applicazione coefficiente di riconoscimento",
        "formula": "Importo × (Eccedenza% / 100) × (Coefficiente% / 100)",
        "calculation": f"€ {amount:,.2f} × ({excess} / 100) × ({coefficient} / 100)",
        "result": f"€ {revision_amount:,.2f}"
    })
    
    # 7. Determina tipologia (aumento/diminuzione)
    revision_type = "aumento" if revision_amount > 0 else "diminuzione" if revision_amount < 0 else "nulla"
    
    return {
        "contract_type": contract_type,
        "indices_config": indices_config,
        "base_value": base_value,
        "comparison_value": comp_value,
        "variation_percent": variation,
        "threshold_percent": threshold,
        "threshold_exceeded": True,
        "excess_percent": excess,
        "recognition_percent": coefficient,
        "revision_amount": revision_amount,
        "revision_amount_abs": abs(revision_amount),
        "revision_type": revision_type,
        "formula_detail": "\n".join(
            f"Passo {s['step']}: {s['description']} — {s['result']}" 
            for s in steps
        ),
        "steps": steps,
        "is_applicable": True,
        "summary": (
            f"Revisione prezzi in {revision_type}: "
            f"€ {abs(revision_amount):,.2f} "
            f"(variazione {variation}%, eccedenza {excess}%, "
            f"coefficiente {coefficient}%)"
        ),
        "normative_reference": params["reference"]
    }


def calculate_multi_component_revision(
    db: Session,
    contract_type: ContractType,
    components: list[dict[str, Any]],  # Ogni componente ha: {amount, indices_config, description}
    base_period: date,
    comparison_period: date,
) -> dict[str, Any]:
    """
    Calcolo revisione per contratti multi-componente (Art. 13 - Appalti multi-oggetto)
    
    Applicabile a:
    - Contratti con prestazioni di natura diversa (CPV diversi)
    - Ogni componente può avere indici diversi
    
    La clausola si attiva solo se la variazione complessiva supera il 5%
    """
    params = NORMATIVE_PARAMS[contract_type]
    threshold = params["threshold_percent"]
    
    component_results = []
    total_amount = 0.0
    weighted_revision = 0.0
    
    for i, comp in enumerate(components):
        result = calculate_price_revision(
            db=db,
            contract_type=contract_type,
            amount=comp["amount"],
            base_period=base_period,
            comparison_period=comparison_period,
            indices_config=comp["indices_config"]
        )
        
        if "error" in result:
            return {
                "error": f"Errore componente {i+1} ({comp.get('description', 'N/D')}): {result['error']}"
            }
        
        component_results.append({
            "component_index": i + 1,
            "description": comp.get("description", f"Componente {i+1}"),
            "amount": comp["amount"],
            "result": result
        })
        
        total_amount += comp["amount"]
        weighted_revision += result["revision_amount"]
    
    # Calcola variazione percentuale complessiva
    overall_variation = (weighted_revision / total_amount) * 100 if total_amount > 0 else 0
    overall_variation = _round(overall_variation, 4)
    
    is_threshold_exceeded = abs(overall_variation) > threshold
    
    return {
        "is_multi_component": True,
        "contract_type": contract_type,
        "total_amount": total_amount,
        "components": component_results,
        "overall_variation_percent": overall_variation,
        "threshold_percent": threshold,
        "threshold_exceeded": is_threshold_exceeded,
        "revision_amount": weighted_revision if is_threshold_exceeded else 0.0,
        "is_applicable": is_threshold_exceeded,
        "summary": (
            f"Contratto multi-componente: {len(components)} componenti. "
            f"Variazione complessiva {overall_variation}%. "
            f"{'Soglia SUPERATA' if is_threshold_exceeded else 'Soglia NON superata'}. "
            f"Revisione: € {abs(weighted_revision) if is_threshold_exceeded else 0:,.2f}"
        ),
        "normative_reference": f"{params['reference']}, Art. 13 - Appalti multi-oggetto"
    }
