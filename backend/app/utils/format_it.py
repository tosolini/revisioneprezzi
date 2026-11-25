"""Utility di formattazione numerica e valutaria in formato italiano."""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal


def format_it_number(
    value: float | int | Decimal | None,
    decimals: int | None = 2,
    trim_trailing_zeros: bool = False,
) -> str:
    """Formatta un numero secondo la convenzione italiana ('.' migliaia, ',' decimali).

    Se ``decimals`` è None, mantiene la precisione significativa del valore
    (rimuovendo gli zeri finali superflui quando ``trim_trailing_zeros=True``).
    """
    if value is None:
        return "—"

    dec = Decimal(str(value))
    if decimals is not None:
        quant = Decimal("1") if decimals == 0 else Decimal(10) ** -decimals
        dec = dec.quantize(quant, rounding=ROUND_HALF_UP)

    if dec == 0:
        dec = Decimal("0") if decimals is None else Decimal("0").quantize(
            Decimal("1") if decimals == 0 else Decimal(10) ** -decimals
        )

    raw = f"{dec:f}" if decimals is None else f"{dec:.{decimals}f}"
    if trim_trailing_zeros and "." in raw:
        raw = raw.rstrip("0").rstrip(".")

    sign = "-" if raw.startswith("-") else ""
    unsigned = raw.lstrip("-")
    if "." in unsigned:
        int_part, frac_part = unsigned.split(".", 1)
    else:
        int_part, frac_part = unsigned, ""

    grouped_int = f"{int(int_part):,}".replace(",", ".")
    if frac_part:
        return f"{sign}{grouped_int},{frac_part}"
    return f"{sign}{grouped_int}"


def format_it_currency(
    value: float | int | Decimal | None,
    decimals: int = 2,
) -> str:
    """Formatta un importo in euro secondo la convenzione italiana (es. '€ 1.234,56')."""
    if value is None:
        return "—"
    formatted = format_it_number(value, decimals=decimals)
    if formatted.startswith("-"):
        return f"-€ {formatted[1:]}"
    return f"€ {formatted}"
