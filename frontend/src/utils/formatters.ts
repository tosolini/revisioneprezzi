export interface FormatNumberOptions {
  decimals?: number;
  minDecimals?: number;
  maxDecimals?: number;
  signed?: boolean;
  fallback?: string;
}

const DEFAULT_FALLBACK = '—';
const numberFormatCache = new Map<string, Intl.NumberFormat>();

function getItNumberFormatter(minDecimals: number, maxDecimals: number): Intl.NumberFormat {
  const key = `${minDecimals}:${maxDecimals}`;
  let formatter = numberFormatCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat('it-IT', {
      useGrouping: 'always',
      minimumFractionDigits: minDecimals,
      maximumFractionDigits: maxDecimals,
    });
    numberFormatCache.set(key, formatter);
  }
  return formatter;
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.abs(n) < 1e-12 ? 0 : n;
}

/**
 * Formatta un numero secondo la convenzione italiana ('.' migliaia, ',' decimali),
 * forzando sempre il separatore delle migliaia anche per numeri a 4 cifre.
 */
export function formatItNumber(value: unknown, options: FormatNumberOptions = {}): string {
  const n = toFiniteNumber(value);
  if (n === null) return options.fallback ?? DEFAULT_FALLBACK;

  const minimumFractionDigits = options.decimals ?? options.minDecimals ?? 0;
  const maximumFractionDigits =
    options.decimals ?? options.maxDecimals ?? Math.max(minimumFractionDigits, 6);

  const formatter = getItNumberFormatter(minimumFractionDigits, maximumFractionDigits);
  const absFormatted = formatter.format(Math.abs(n));
  const zeroFormatted = formatter.format(0);

  if (absFormatted === zeroFormatted) {
    return options.signed ? `+${absFormatted}` : absFormatted;
  }
  if (n < 0) return `-${absFormatted}`;
  if (options.signed) return `+${absFormatted}`;
  return absFormatted;
}

/**
 * Formatta un importo in euro in formato italiano (es. '€ 1.234,56' o '+€ 1.234,56').
 */
export function formatItCurrency(
  value: unknown,
  options: { decimals?: number; signed?: boolean; fallback?: string } = {},
): string {
  const n = toFiniteNumber(value);
  if (n === null) return options.fallback ?? DEFAULT_FALLBACK;

  const decimals = options.decimals ?? 2;
  const formatted = formatItNumber(n, { decimals, signed: options.signed });
  if (formatted.startsWith('-')) return `-€ ${formatted.slice(1)}`;
  if (formatted.startsWith('+')) return `+€ ${formatted.slice(1)}`;
  return `€ ${formatted}`;
}

/**
 * Formatta una percentuale in formato italiano (es. '10,50%' o '+10,5000%').
 */
export function formatItPercent(value: unknown, options: FormatNumberOptions = {}): string {
  const n = toFiniteNumber(value);
  if (n === null) return options.fallback ?? DEFAULT_FALLBACK;
  return `${formatItNumber(n, options)}%`;
}

function usNumberToIt(raw: string): string {
  const sign = raw.startsWith('-') ? '-' : '';
  const unsigned = raw.replace(/^-/, '');
  const parts = unsigned.split('.');
  const intDigits = parts[0].replace(/,/g, '');
  const groupedInt = intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  if (parts.length === 2 && parts[1] !== '') {
    return `${sign}${groupedInt},${parts[1]}`;
  }
  return `${sign}${groupedInt}`;
}

/**
 * Converte in visualizzazione eventuali stringhe numeriche in formato americano
 * (es. '€ 100,000.00', '10.5000%') provenienti da snapshot storici salvati in DB,
 * lasciando intatti codici serie, date ISO e riferimenti normativi (es. 'II.2-bis').
 */
export function normalizeLegacyItNumbers(text: string): string {
  if (!text) return text;
  // 1. Importi espliciti in euro in formato US (es. '€ 100,000.00' o '€ 1,234' o '€ 123.45')
  let out = text.replace(
    /€\s*(-?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+))(?![.,\d])/g,
    (_m, num: string) => `€ ${usNumberToIt(num)}`,
  );
  // 2. Numeri con decimali col punto (o migliaia con virgola + punto) non già in formato IT
  // Evita regex lookbehind per compatibilità con tutti i runtime JS catturando il confine iniziale.
  out = out.replace(
    /(^|[^A-Za-z0-9._/,-])(-?(?:\d{1,3}(?:,\d{3})+\.\d+|\d+\.\d+))(?![A-Za-z0-9._/,-])/g,
    (_m, prefix: string, num: string) => `${prefix}${usNumberToIt(num)}`,
  );
  return out;
}
