"""
Servizio di calcolo revisione prezzi semplificato secondo D.lgs 36/2023 Allegato II.2-bis
Supporta sia LAVORI (TOL) che SERVIZI/FORNITURE (CPV)
"""

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
        "reference": "Art. 3 comma 2-3, Allegato II.2-bis - Lavori",
    },
    "services": {
        "threshold_percent": 5.0,
        "recognition_rate_percent": 80.0,
        "reference": "Art. 3 comma 2-3, Allegato II.2-bis - Servizi",
    },
    "supplies": {
        "threshold_percent": 5.0,
        "recognition_rate_percent": 80.0,
        "reference": "Art. 3 comma 2-3, Allegato II.2-bis - Forniture",
    },
}


def _round(val: float, decimals: int = 2) -> float:
    """Arrotonda un valore con precisione specificata"""
    d = Decimal(str(val)).quantize(Decimal(10) ** -decimals, rounding=ROUND_HALF_UP)
    return float(d)


def _add_months(d: date, n: int) -> date:
    """Somma n mesi a una data (giorno conservato; qui sempre primo del mese)."""
    m = d.month - 1 + n
    return date(d.year + m // 12, m % 12 + 1, d.day)


def _missing_months(used: date, requested: date) -> list[str]:
    """Mesi solari non registrati tra il periodo usato e quello richiesto.

    Fallback all'indietro (usato 2026-06, richiesto 2026-08) →
    ['2026-07', '2026-08']; fallback in avanti (usato 2026-06, richiesto
    2026-03) → ['2026-03', '2026-04', '2026-05']. Il periodo usato è escluso,
    quello richiesto sempre incluso (è il periodo che manca)."""
    months: list[str] = []
    cur = used
    direction = 1 if used <= requested else -1
    while True:
        cur = _add_months(cur, direction)
        if direction > 0 and cur > requested:
            break
        if direction < 0 and cur < requested:
            break
        months.append(cur.isoformat()[:7])
    return sorted(months)  # ordine cronologico indipendente dalla direzione del fallback


def _get_index_observation(
    db: Session, series_id: str, period: date
) -> tuple[float | None, date | None, bool]:
    """Recupera l'osservazione ISTAT per serie e periodo.

    Ritorna ``(valore, periodo_usato, esatto)`` dove ``periodo_usato`` è il
    periodo dell'osservazione effettivamente utilizzata (può differire da
    ``period`` per fallback) ed ``esatto`` indica se esiste l'osservazione
    definitiva nel periodo richiesto.

    Strategia (coerente con il calcolo): osservazione esatta definitiva,
    altrimenti la più vicina precedente, altrimenti la più vicina successiva.
    """
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
        return obs.value, obs.ref_period, True

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
        return before.value, before.ref_period, False

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
    if after:
        return after.value, after.ref_period, False
    return None, None, False


def calculate_period_coverage(
    db: Session,
    components: dict[str, float],
    base_period: date,
    comparison_period: date,
) -> list[dict]:
    """Copertura dei periodi richiesti per ciascuna serie componente.

    Riporta, per ogni serie, l'osservazione che il calcolo utilizzerebbe
    (periodo usato, valore ed esattezza rispetto al periodo richiesto).
    ``satisfied`` = entrambi i periodi coperti con osservazione esatta.
    ``missing`` = nessuna osservazione definitiva disponibile (il calcolo
    fallirebbe per questa serie).
    """
    coverage = []
    for series_id, weight in components.items():
        base_value, used_base, base_exact = _get_index_observation(db, series_id, base_period)
        comp_value, used_comp, comp_exact = _get_index_observation(db, series_id, comparison_period)
        coverage.append(
            {
                "series_id": series_id,
                "weight": weight,
                "base": {
                    "requested": base_period.isoformat(),
                    "used": used_base.isoformat() if used_base else None,
                    "value": base_value,
                    "exact": base_exact,
                    "missing_months": (
                        _missing_months(used_base, base_period)
                        if used_base and not base_exact
                        else []
                    ),
                },
                "comparison": {
                    "requested": comparison_period.isoformat(),
                    "used": used_comp.isoformat() if used_comp else None,
                    "value": comp_value,
                    "exact": comp_exact,
                    "missing_months": (
                        _missing_months(used_comp, comparison_period)
                        if used_comp and not comp_exact
                        else []
                    ),
                },
                "satisfied": bool(base_exact and comp_exact),
                "missing": base_value is None or comp_value is None,
            }
        )
    return coverage


def _get_index_observation(
    db: Session, series_id: str, period: date
) -> tuple[float | None, date | None, bool]:
    """Recupera l'osservazione ISTAT per serie e periodo.

    Ritorna ``(valore, periodo_usato, esatto)`` dove ``periodo_usato`` è il
    periodo dell'osservazione effettivamente utilizzata (può differire da
    ``period`` per fallback) ed ``esatto`` indica se esiste l'osservazione
    definitiva nel periodo richiesto.
    """
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
        return obs.value, obs.ref_period, True

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
        return before.value, before.ref_period, False

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
    if after:
        return after.value, after.ref_period, False
    return None, None, False


def _get_index_value(db: Session, series_id: str, period: date) -> float | None:
    """Recupera valore indice ISTAT per serie e periodo specifico (con fallback)."""
    value, _used, _exact = _get_index_observation(db, series_id, period)
    return value


def _periods_evidence(
    db: Session, series_ids: list[str], base_period: date, comparison_period: date
) -> dict:
    """Evidenza aggregata sulla copertura dei periodi richiesti per un insieme
    di serie: periodo usato (ultima osservazione disponibile considerata),
    esattezza e mesi solari non registrati. Per il periodo di confronto la
    segnalazione risponde a: "il calcolo non ha registrato quei mesi, quindi
    è partito dall'osservazione di <periodo usato>"."""
    base_used: set[str] = set()
    comp_used: set[str] = set()
    base_missing: set[str] = set()
    comp_missing: set[str] = set()
    base_exact_all = True
    comp_exact_all = True
    for series_id in series_ids:
        _bv, used_base, base_exact = _get_index_observation(db, series_id, base_period)
        _cv, used_comp, comp_exact = _get_index_observation(db, series_id, comparison_period)
        if used_base:
            base_used.add(used_base.isoformat())
            if not base_exact:
                base_missing.update(_missing_months(used_base, base_period))
        if not base_exact:
            base_exact_all = False
        if used_comp:
            comp_used.add(used_comp.isoformat())
            if not comp_exact:
                comp_missing.update(_missing_months(used_comp, comparison_period))
        if not comp_exact:
            comp_exact_all = False
    return {
        "base": {
            "requested": base_period.isoformat(),
            "used": sorted(base_used)[-1] if base_used else None,
            "exact": base_exact_all,
            "missing_months": sorted(base_missing),
        },
        "comparison": {
            "requested": comparison_period.isoformat(),
            "used": sorted(comp_used)[-1] if comp_used else None,
            "exact": comp_exact_all,
            "missing_months": sorted(comp_missing),
        },
    }


def calculate_synthetic_index(
    db: Session,
    indices: dict[str, float],  # {series_id: weight_percent}
    period: date,
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

    return _round(synthetic, 4), []


def calculate_weighted_variation(
    db: Session,
    components: dict[str, float],  # {series_id: weight_percent}
    base_period: date,
    comparison_period: date,
) -> tuple[float | None, list[dict], list[str]]:
    """
    Variazione come media ponderata delle variazioni dei singoli indici
    (Tabella D punto 7): Vt = Σ(wi/100)·Vt(i), dove
    Vt(i) = ((I_confronto − I_base) / I_base) × 100 per ciascun componente.

    Returns:
        (variazione_totale, component_details, errori)
    component_details = [{series_id, weight, base_value, comparison_value,
                        variation_percent}] per componente.
    """
    total_weight = sum(components.values())
    if abs(total_weight - 100.0) > 0.01:
        return None, [], [f"I pesi devono sommarsi a 100% (attuale: {total_weight}%)"]

    errors = []
    details = []
    weighted_sum = 0.0

    for series_id, weight in components.items():
        base_value, used_base, base_exact = _get_index_observation(db, series_id, base_period)
        comp_value, used_comp, comp_exact = _get_index_observation(db, series_id, comparison_period)
        if base_value is None or comp_value is None:
            missing = []
            if base_value is None:
                missing.append(f"periodo base {base_period}")
            if comp_value is None:
                missing.append(f"periodo di confronto {comparison_period}")
            errors.append(f"Indice {series_id} non trovato per {', '.join(missing)}")
            continue
        variation = ((comp_value - base_value) / base_value) * 100
        variation = _round(variation, 4)
        contribution = _round((weight / 100.0) * variation, 4)
        details.append(
            {
                "series_id": series_id,
                "weight": weight,
                "base_value": base_value,
                "comparison_value": comp_value,
                "variation_percent": variation,
                "contribution_percent": contribution,
                "used_base_period": used_base.isoformat() if used_base else None,
                "used_comparison_period": used_comp.isoformat() if used_comp else None,
                "base_exact": base_exact,
                "comparison_exact": comp_exact,
                "missing_base_months": (
                    _missing_months(used_base, base_period) if used_base and not base_exact else []
                ),
                "missing_comparison_months": (
                    _missing_months(used_comp, comparison_period)
                    if used_comp and not comp_exact
                    else []
                ),
            }
        )
        weighted_sum += contribution

    if errors:
        return None, details, errors

    return _round(weighted_sum, 4), details, []


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
    steps.append(
        {
            "step": 0,
            "description": "Parametri normativi applicabili",
            "details": {
                "tipo_contratto": contract_type,
                "soglia_attivazione": f"{threshold}%",
                "coefficiente_riconoscimento": f"{coefficient}%",
                "riferimento": params["reference"],
            },
            "result": f"Soglia {threshold}%, Coefficiente {coefficient}%",
        }
    )

    # 2. Calcola indici base e confronto
    index_type = indices_config.get("type", "single")

    method = indices_config.get("method", "weighted_values")
    weighted_component_variations = None
    # Pre-inizializza per CodeQL e per gestire correttamente entrambi i rami single/composite
    series_id: str | None = indices_config.get("single_series_id")  # valorizzato solo se single
    components: dict[str, float] = {}
    variation_w: float | None = None
    comp_details: list[dict] = []
    base_value: float | None = None
    comp_value: float | None = None

    if index_type == "single":
        series_id = indices_config["single_series_id"]
        base_value, used_base, base_exact = _get_index_observation(db, series_id, base_period)
        comp_value, used_comp, comp_exact = _get_index_observation(db, series_id, comparison_period)

        if base_value is None or comp_value is None:
            missing_parts = []
            if base_value is None:
                missing_parts.append(f" Periodo base: {base_period}")
            if comp_value is None:
                missing_parts.append(f" Periodo di confronto: {comparison_period}")
            return {
                "error": (
                    "La serie ISTAT selezionata non contiene dati definitivi per i periodi richiesti.\n"  # noqa: E501
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

        steps.append(
            {
                "step": 1,
                "description": "Recupero indici ISTAT",
                "details": {
                    "serie": series_id,
                    "periodo_base": base_period.isoformat(),
                    "valore_base": base_value,
                    "periodo_confronto": comparison_period.isoformat(),
                    "valore_confronto": comp_value,
                },
                "result": f"Indice base: {base_value}, Indice confronto: {comp_value}",
            }
        )

    else:  # composite
        components = indices_config["components"] or {}

        method = indices_config.get("method", "weighted_values")
        weighted_component_variations = None

        if method == "weighted_variations":
            variation_w, comp_details, weighted_errors = calculate_weighted_variation(
                db, components, base_period, comparison_period
            )
            if weighted_errors:
                return {
                    "error": "Errori nel calcolo media ponderata variazioni",
                    "comparison_errors": weighted_errors,
                }
            # Valori sintetici solo per display (media ponderata dei VALORI)
            base_value, base_errors = calculate_synthetic_index(db, components, base_period)
            comp_value, comp_errors = calculate_synthetic_index(db, components, comparison_period)
            weighted_component_variations = comp_details
        else:
            base_value, base_errors = calculate_synthetic_index(db, components, base_period)
            comp_value, comp_errors = calculate_synthetic_index(db, components, comparison_period)
        component_details = None
        calculation_display = None
        if method == "weighted_variations":
            component_details = [
                {
                    "series_id": d["series_id"],
                    "weight": d["weight"],
                    "base_value": d["base_value"],
                    "comparison_value": d["comparison_value"],
                    "variation_percent": d["variation_percent"],
                    "contribution_percent": d["contribution_percent"],
                    "used_base_period": d["used_base_period"],
                    "used_comparison_period": d["used_comparison_period"],
                    "base_exact": d["base_exact"],
                    "comparison_exact": d["comparison_exact"],
                    "missing_base_months": d["missing_base_months"],
                    "missing_comparison_months": d["missing_comparison_months"],
                }
                for d in comp_details
            ]
            terms = [
                f"({d['weight'] / 100:.2f})×{d['variation_percent']:.4f}" for d in component_details
            ]
            calculation_display = "Vt = " + " + ".join(terms) + f" = {variation_w:.4f}%"

        steps.append(
            {
                "step": 1,
                "description": (
                    "Calcolo media ponderata delle variazioni"
                    if method == "weighted_variations"
                    else "Calcolo indice sintetico ponderato"
                ),
                "details": {
                    "componenti": components,
                    "formula": (
                        "Vt = Σ(wi/100)·Vt(i), Vt(i) = ((Ii_confronto − Ii_base)/Ii_base) × 100"
                        if method == "weighted_variations"
                        else "Is = Σ(pi × Ii) dove pi è il peso percentuale"
                    ),
                    "periodo_base": base_period.isoformat(),
                    "indice_sintetico_base": base_value,
                    "periodo_confronto": comparison_period.isoformat(),
                    "indice_sintetico_confronto": comp_value,
                    **(
                        {"component_details": component_details, "calculation": calculation_display}
                        if method == "weighted_variations"
                        else {}
                    ),
                },
                "result": (
                    f"Vt = {variation_w}%"
                    if method == "weighted_variations"
                    else f"Is base: {base_value}, Is confronto: {comp_value}"
                ),
            }
        )
    # Evidenza sui periodi richiesti: mesi non registrati e periodo usato.
    period_evidence = _periods_evidence(
        db,
        [series_id] if index_type == "single" and series_id else list(components.keys()),
        base_period,
        comparison_period,
    )

    # 3. Calcola variazione percentuale
    if method == "weighted_variations":
        # variation_w è definito solo in ramo composite+weighted_variations; fallback difensivo
        assert variation_w is not None, "variation_w deve essere calcolata per weighted_variations"
        variation = variation_w
    else:
        assert base_value is not None and comp_value is not None and base_value != 0
        variation = ((comp_value - base_value) / base_value) * 100
        variation = _round(variation, 4)

    steps.append(
        {
            "step": 2,
            "description": "Calcolo variazione percentuale",
            "formula": "((I_confronto - I_base) / I_base) × 100",
            "calculation": f"(({comp_value} - {base_value}) / {base_value}) × 100",
            "result": f"{variation}%",
        }
    )
    # 4. Verifica superamento soglia
    is_threshold_exceeded = abs(variation) > threshold

    steps.append(
        {
            "step": 3,
            "description": "Verifica soglia di attivazione",
            "formula": "|Variazione%| > Soglia%",
            "calculation": f"|{variation}%| > {threshold}%",
            "result": "SOGLIA SUPERATA" if is_threshold_exceeded else "SOGLIA NON SUPERATA",
        }
    )

    if not is_threshold_exceeded:
        return {
            "contract_type": contract_type,
            "indices_config": indices_config,
            "base_value": base_value,
            "comparison_value": comp_value,
            "variation_percent": variation,
            "weighted_component_variations": weighted_component_variations,
            "period_evidence": period_evidence,
            "threshold_percent": threshold,
            "threshold_exceeded": False,
            "excess_percent": 0.0,
            "recognition_percent": coefficient,
            "revision_amount": 0.0,
            "formula_detail": "\n".join(
                f"Passo {s['step']}: {s['description']} — {s['result']}" for s in steps
            ),
            "steps": steps,
            "is_applicable": False,
            "summary": f"Nessuna revisione: variazione {variation}% entro soglia {threshold}%",
        }

    # 5. Calcola eccedenza rispetto alla soglia
    # Mantiene il segno della variazione (positivo = aumento, negativo = diminuzione)
    if variation > 0:
        excess = variation - threshold
    else:
        excess = variation + threshold

    excess = _round(excess, 4)

    steps.append(
        {
            "step": 4,
            "description": "Calcolo quota eccedente la soglia",
            "formula": "Variazione% - Soglia% (se positiva) o Variazione% + Soglia% (se negativa)",
            "calculation": f"{variation}% {'−' if variation > 0 else '+'} {threshold}% = {excess}%",
            "result": f"Eccedenza: {excess}%",
        }
    )

    # 6. Applicazione coefficiente di riconoscimento
    revision_amount = amount * (excess / 100.0) * (coefficient / 100.0)
    revision_amount = _round(revision_amount, 2)

    steps.append(
        {
            "step": 5,
            "description": "Applicazione coefficiente di riconoscimento",
            "formula": "Importo × (Eccedenza% / 100) × (Coefficiente% / 100)",
            "calculation": f"€ {amount:,.2f} × ({excess} / 100) × ({coefficient} / 100)",
            "result": f"€ {revision_amount:,.2f}",
        }
    )

    # 7. Determina tipologia (aumento/diminuzione)
    revision_type = (
        "aumento" if revision_amount > 0 else "diminuzione" if revision_amount < 0 else "nulla"
    )

    return {
        "contract_type": contract_type,
        "indices_config": indices_config,
        "base_value": base_value,
        "comparison_value": comp_value,
        "variation_percent": variation,
        "weighted_component_variations": weighted_component_variations,
        "period_evidence": period_evidence,
        "threshold_percent": threshold,
        "threshold_exceeded": True,
        "excess_percent": excess,
        "recognition_percent": coefficient,
        "revision_amount": revision_amount,
        "revision_amount_abs": abs(revision_amount),
        "revision_type": revision_type,
        "formula_detail": "\n".join(
            f"Passo {s['step']}: {s['description']} — {s['result']}" for s in steps
        ),
        "steps": steps,
        "is_applicable": True,
        "summary": (
            f"Revisione prezzi in {revision_type}: "
            f"€ {abs(revision_amount):,.2f} "
            f"(variazione {variation}%, eccedenza {excess}%, "
            f"coefficiente {coefficient}%)"
        ),
        "normative_reference": params["reference"],
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
            indices_config=comp["indices_config"],
        )

        if "error" in result:
            return {
                "error": (
                    f"Errore componente {i + 1} ({comp.get('description', 'N/D')}): "
                    f"{result['error']}"
                ),
            }

        component_results.append(
            {
                "component_index": i + 1,
                "description": comp.get("description", f"Componente {i + 1}"),
                "amount": comp["amount"],
                "result": result,
            }
        )

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
        "normative_reference": f"{params['reference']}, Art. 13 - Appalti multi-oggetto",
    }
