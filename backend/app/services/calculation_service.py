import json
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, getcontext
from typing import Any

from sqlalchemy.orm import Session

from app.models.index_observation import IndexObservation
from app.models.normative_param import NormativeParam
from app.models.revision_result import RevisionResult

getcontext().prec = 28


def _get_param(db: Session, param_id: str) -> float:
    param = db.query(NormativeParam).filter(NormativeParam.id == param_id).first()
    return param.value if param else 0.0


def _round(val: float, decimals: int = 2) -> float:
    d = Decimal(str(val)).quantize(Decimal(10) ** -decimals, rounding=ROUND_HALF_UP)
    return float(d)


def _get_index_value(db: Session, series_id: str, period: date) -> float | None:
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


def _normative_label(param_id: str) -> str:
    labels = {
        "activation_threshold": "Soglia di attivazione",
        "recognition_rate": "Coefficiente riconoscibile",
    }
    return labels.get(param_id, param_id)


def calculate_single(
    db: Session,
    series_id: str,
    base_period: date,
    comparison_period: date,
    amount: float,
    threshold: float | None = None,
    recognition_rate: float | None = None,
) -> dict[str, Any]:
    if threshold is None:
        threshold = _get_param(db, "activation_threshold")
    if recognition_rate is None:
        recognition_rate = _get_param(db, "recognition_rate")

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

    variation = ((comp_value - base_value) / base_value) * 100
    variation = _round(variation, 4)

    steps = []
    steps.append({
        "step": 1,
        "description": "Calcolo variazione percentuale",
        "formula": f"(({comp_value} - {base_value}) / {base_value}) * 100",
        "result": f"{variation}%",
    })

    if abs(variation) <= threshold:
        steps.append({
            "step": 2,
            "description": "Verifica soglia di attivazione",
            "formula": f"|{variation}%| <= {threshold}%",
            "result": "Nessuna revisione: variazione entro la soglia",
        })
        return {
            "series_id": series_id,
            "base_value": base_value,
            "comparison_value": comp_value,
            "variation_percent": variation,
            "threshold_percent": threshold,
            "excess_percent": 0.0,
            "recognition_percent": recognition_rate,
            "revision_amount": 0.0,
            "formula_detail": "\n".join(
                f"Passo {s['step']}: {s['description']} — {s['result']}" for s in steps
            ),
            "steps": steps,
            "is_applicable": False,
        }

    excess = variation - threshold if variation > 0 else variation + threshold
    # Se la variazione è negativa (deflazione), excess potrebbe essere negativo
    excess = _round(excess, 4)

    steps.append({
        "step": 2,
        "description": "Verifica soglia di attivazione",
        "formula": f"|{variation}%| > {threshold}%",
        "result": "Soglia superata",
    })
    steps.append({
        "step": 3,
        "description": "Calcolo quota eccedente",
        "formula": f"{variation}% - {threshold}% = {excess}%",
        "result": f"{excess}%",
    })

    revision_amount = amount * (excess / 100) * (recognition_rate / 100)
    revision_amount = _round(revision_amount)

    steps.append({
        "step": 4,
        "description": "Applicazione coefficiente riconoscibile",
        "formula": f"{amount} × ({excess} / 100) × ({recognition_rate} / 100)",
        "result": f"€ {revision_amount:,.2f}",
    })

    return {
        "series_id": series_id,
        "base_value": base_value,
        "comparison_value": comp_value,
        "variation_percent": variation,
        "threshold_percent": threshold,
        "excess_percent": excess,
        "recognition_percent": recognition_rate,
        "revision_amount": revision_amount,
        "formula_detail": "\n".join(
            f"Passo {s['step']}: {s['description']} — {s['result']}" for s in steps
        ),
        "steps": steps,
        "is_applicable": True,
    }


def calculate_composite(
    db: Session,
    components: list[dict[str, Any]],
    base_period: date,
    comparison_period: date,
    amount: float,
    threshold: float | None = None,
    recognition_rate: float | None = None,
) -> dict[str, Any]:
    component_results = []
    total_weight = sum(c["weight"] for c in components)

    if abs(total_weight - 100.0) > 0.01:
        return {"error": f"I pesi devono sommarsi a 100 (attuale: {total_weight})"}

    weighted_revision = 0.0
    for comp in components:
        result = calculate_single(
            db=db,
            series_id=comp["series_id"],
            base_period=base_period,
            comparison_period=comparison_period,
            amount=amount * (comp["weight"] / 100),
            threshold=threshold,
            recognition_rate=recognition_rate,
        )
        if "error" in result:
            return result
        component_results.append({
            "series_id": comp["series_id"],
            "weight": comp["weight"],
            "result": result,
        })
        if result["is_applicable"]:
            weighted_revision += result["revision_amount"]

    weighted_revision = _round(weighted_revision)
    return {
        "is_composite": True,
        "components": component_results,
        "revision_amount": weighted_revision,
        "threshold_percent": threshold or _get_param(db, "activation_threshold"),
        "recognition_percent": recognition_rate or _get_param(db, "recognition_rate"),
        "formula_detail": "Indice composito pesato:\n" + "\n".join(
            f"  - {c['series_id']} ({c['weight']}%): € {c['result']['revision_amount']:,.2f}"
            for c in component_results
        ),
        "is_applicable": weighted_revision > 0,
    }


def save_result(db: Session, case_id, result: dict[str, Any], version: int = 1) -> RevisionResult:
    steps = result.get("steps", [])
    record = RevisionResult(
        case_id=case_id,
        base_value=result.get("base_value"),
        comparison_value=result.get("comparison_value"),
        variation_percent=result.get("variation_percent"),
        threshold_percent=result.get("threshold_percent"),
        excess_percent=result.get("excess_percent"),
        recognition_percent=result.get("recognition_percent"),
        revision_amount=result.get("revision_amount", 0.0),
        formula_detail=json.dumps(steps, ensure_ascii=False) if steps else result.get("formula_detail"),
        result_version=version,
    )
    db.add(record)
    db.flush()
    return record
