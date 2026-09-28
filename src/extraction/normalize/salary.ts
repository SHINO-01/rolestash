import type { Salary, SalaryPeriod } from '@/domain/job';
import { cleanText } from './text';

/**
 * Salary parsing for both schema.org MonetaryAmount objects and free text
 * such as "$120,000 – $140,000 + super" or "£45k-55k per annum".
 *
 * Deliberately conservative: an ambiguous "$" stays currency-less unless the
 * caller supplies a default (adapters know their market, e.g. SEEK → AUD).
 */

const SYMBOL_CURRENCIES: Record<string, string> = {
  A$: 'AUD',
  AU$: 'AUD',
  AUD$: 'AUD',
  NZ$: 'NZD',
  C$: 'CAD',
  CA$: 'CAD',
  US$: 'USD',
  S$: 'SGD',
  HK$: 'HKD',
  '£': 'GBP',
  '€': 'EUR',
  '₹': 'INR',
  '¥': 'JPY',
  '₱': 'PHP',
  RM: 'MYR',
  Rp: 'IDR',
};
const ISO_CODES = new Set([
  'AUD',
  'NZD',
  'USD',
  'CAD',
  'GBP',
  'EUR',
  'INR',
  'SGD',
  'HKD',
  'JPY',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'MYR',
  'IDR',
  'PHP',
  'THB',
  'ZAR',
  'AED',
]);

const PERIOD_PATTERNS: [RegExp, SalaryPeriod][] = [
  [/\b(per|an?|\/)\s*(hour|hr)\b|\bhourly\b|\bp\/?h\b|\/\s*h\b/i, 'hour'],
  [/\b(per|an?|\/)\s*day\b|\bdaily\b|\bp\/?d\b/i, 'day'],
  [/\b(per|an?|\/)\s*week\b|\bweekly\b|\bp\/?w\b/i, 'week'],
  [/\b(per|an?|\/)\s*month\b|\bmonthly\b|\bp\/?m\b/i, 'month'],
  [
    /\b(per|an?|\/)\s*(year|annum|yr)\b|\bannual(ly)?\b|\bp\.?\s?a\.?(?![a-z])|\byearly\b|\bLPA\b/i,
    'year',
  ],
];

const SCHEMA_PERIODS: Record<string, SalaryPeriod> = {
  HOUR: 'hour',
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
  YEAR: 'year',
};

// A money amount: optional currency, number with separators, optional k/m suffix.
const AMOUNT =
  /(?<cur>A\$|AU\$|AUD\$|NZ\$|C\$|CA\$|US\$|S\$|HK\$|RM|Rp|[$£€₹¥₱]|\b[A-Z]{3}\b)?\s?(?<num>\d{1,3}(?:[,\s.]\d{3})+|\d+(?:\.\d+)?)\s?(?<suffix>[kKmM](?![a-zA-Z])|LPA|[Ll]akhs?|[Ll]acs?)?/g;

interface Amount {
  value: number;
  currency?: string;
  hasSuffix: boolean;
  /** Multiplier applied by the suffix (k → 1000), 1 when none. */
  multiplier: number;
}

function toNumber(num: string): number {
  // "120,000" / "120 000" / "120.000" (EU thousands) → 120000; "57.50" stays decimal.
  if (/^\d{1,3}([,\s.]\d{3})+$/.test(num)) return Number(num.replace(/[,\s.]/g, ''));
  return Number(num);
}

function readAmounts(text: string): Amount[] {
  const amounts: Amount[] = [];
  for (const m of text.matchAll(AMOUNT)) {
    const groups = m.groups ?? {};
    const rawCur = groups.cur;
    let currency: string | undefined;
    if (rawCur) {
      currency =
        SYMBOL_CURRENCIES[rawCur] ??
        (ISO_CODES.has(rawCur) ? rawCur : rawCur === '$' ? '$' : undefined);
      // A random 3-letter uppercase word that is not a currency is not a currency.
      if (!currency && /^[A-Z]{3}$/.test(rawCur)) continue;
    }
    const raw = toNumber(groups.num ?? '');
    if (!Number.isFinite(raw)) continue;
    const suffix = groups.suffix?.toLowerCase();
    let multiplier = 1;
    if (suffix === 'k') multiplier = 1_000;
    else if (suffix === 'm') multiplier = 1_000_000;
    else if (suffix === 'lpa' || suffix?.startsWith('lakh') || suffix?.startsWith('lac')) {
      multiplier = 100_000;
      currency ??= 'INR';
    }
    amounts.push({
      value: raw * multiplier,
      ...(currency ? { currency } : {}),
      hasSuffix: Boolean(suffix),
      multiplier,
    });
  }
  // "$120-140k" / "12-18 Lacs": a unit on the upper bound applies to the lower one too.
  const [first, second] = amounts;
  if (
    first &&
    second &&
    !first.hasSuffix &&
    second.hasSuffix &&
    first.value < second.value / second.multiplier + 1
  ) {
    first.value *= second.multiplier;
    first.hasSuffix = true;
  }
  return amounts;
}

export function detectPeriod(text: string): SalaryPeriod | undefined {
  return PERIOD_PATTERNS.find(([re]) => re.test(text))?.[1];
}

/**
 * Parses free-text salary. Returns undefined when the text contains no
 * plausible money amount (so "Competitive salary" is kept only as text by
 * the caller if it wants).
 */
export function parseSalaryText(input: string, defaultCurrency?: string): Salary | undefined {
  const text = cleanText(input);
  if (!text || text.length > 200) return undefined;

  const amounts = readAmounts(text).filter(
    (a) => a.currency !== undefined || a.hasSuffix || a.value >= 10,
  );
  // Require a currency marker, a k-suffix or a period word — otherwise "5+ years" looks like pay.
  const period = detectPeriod(text);
  const signal =
    amounts.some((a) => a.currency !== undefined || a.hasSuffix) || period !== undefined;
  if (amounts.length === 0 || !signal) return { text };

  const [first, second] = amounts;
  const values = [first, second].filter((a): a is Amount => a !== undefined).map((a) => a.value);
  const min = Math.min(...values);
  const max = Math.max(...values);

  const explicit = amounts.find((a) => a.currency && a.currency !== '$')?.currency;
  const currency = explicit ?? defaultCurrency;

  const salary: Salary = { text, min };
  if (max !== min) salary.max = max;
  if (currency) salary.currency = currency;
  salary.period = period ?? inferPeriod(max);
  return salary;
}

/** Guess the period from magnitude when the text doesn't say. */
function inferPeriod(amount: number): SalaryPeriod | undefined {
  if (amount >= 15_000) return 'year';
  if (amount > 0 && amount <= 500) return 'hour';
  return undefined;
}

/** schema.org `baseSalary` / `estimatedSalary` (MonetaryAmount or number). */
export function salaryFromSchema(node: unknown, defaultCurrency?: string): Salary | undefined {
  if (node == null) return undefined;
  if (Array.isArray(node)) return salaryFromSchema(node[0], defaultCurrency);
  if (typeof node === 'number')
    return { min: node, ...(defaultCurrency ? { currency: defaultCurrency } : {}) };
  if (typeof node === 'string') return parseSalaryText(node, defaultCurrency);
  if (typeof node !== 'object') return undefined;

  const obj = node as Record<string, unknown>;
  const rawValue = obj.value;
  const value =
    rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)
      ? (rawValue as Record<string, unknown>)
      : { value: rawValue };

  const num = (v: unknown): number | undefined => {
    const n = typeof v === 'string' ? Number(v.replace(/[,\s]/g, '')) : v;
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const min = num(value.minValue) ?? num(value.value) ?? num(obj.minValue);
  const max = num(value.maxValue) ?? num(obj.maxValue);
  if (min === undefined && max === undefined) return undefined;

  const unitRaw = value.unitText ?? obj.unitText;
  const unit = typeof unitRaw === 'string' ? unitRaw.toUpperCase() : '';
  const currencyRaw = typeof obj.currency === 'string' ? obj.currency.toUpperCase().trim() : '';
  const currency = /^[A-Z]{3}$/.test(currencyRaw) ? currencyRaw : defaultCurrency;

  const salary: Salary = {};
  if (min !== undefined) salary.min = min;
  if (max !== undefined && max !== min) salary.max = max;
  if (currency) salary.currency = currency;
  const period = SCHEMA_PERIODS[unit] ?? inferPeriod(max ?? min ?? 0);
  if (period) salary.period = period;
  return salary;
}

/** Display helper shared by UI: "A$120k – 140k / yr". */
export function formatSalary(salary: Salary | undefined, locale?: string): string | undefined {
  if (!salary) return undefined;
  if (salary.min === undefined && salary.max === undefined) return salary.text;
  const compact = (n: number): string =>
    new Intl.NumberFormat(locale, {
      notation: n >= 10_000 ? 'compact' : 'standard',
      maximumFractionDigits: n >= 10_000 ? 1 : 2,
    }).format(n);
  const symbol = salary.currency ? currencySymbol(salary.currency, locale) : '';
  const range =
    salary.min !== undefined && salary.max !== undefined
      ? `${symbol}${compact(salary.min)} – ${compact(salary.max)}`
      : `${symbol}${compact(salary.min ?? salary.max ?? 0)}`;
  const suffix = salary.period ? ` / ${PERIOD_LABEL[salary.period]}` : '';
  return range + suffix;
}

const PERIOD_LABEL: Record<SalaryPeriod, string> = {
  hour: 'hr',
  day: 'day',
  week: 'wk',
  month: 'mo',
  year: 'yr',
};

function currencySymbol(code: string, locale?: string): string {
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0);
    const sym = parts.find((p) => p.type === 'currency')?.value ?? code;
    // Disambiguate dollars other than the reader's own.
    return sym === '$' && code !== 'USD' ? `${code.slice(0, 1)}$` : sym;
  } catch {
    return `${code} `;
  }
}
