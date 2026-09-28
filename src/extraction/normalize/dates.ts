import { cleanText } from './text';

/**
 * Normalises posting dates to ISO strings.
 *  - Absolute dates ("2026-09-01", "2026-09-01T10:00:00+10:00", "1 Sep 2026") → ISO
 *  - Relative dates ("Posted 3d ago", "2 weeks ago", "today") → ISO date relative to `now`
 */

export function toIsoDate(value: unknown, now: Date = new Date()): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const text = cleanText(String(value));
  if (!text) return undefined;

  const relative = parseRelativeDate(text, now);
  if (relative) return relative;

  // Date-only ISO stays date-only (no timezone guessing).
  const dateOnly = /^(\d{4}-\d{2}-\d{2})$/.exec(text);
  if (dateOnly) return dateOnly[1];

  const cleaned = text.replace(/^(posted|closes?|closing|listed|date posted|expires?)[:\s]+/i, '');
  const parsed = new Date(cleaned);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const year = parsed.getUTCFullYear();
  if (year < 2000 || year > now.getUTCFullYear() + 5) return undefined;
  return /\d{1,2}:\d{2}/.test(cleaned) ? parsed.toISOString() : formatLocalDate(parsed);
}

const UNIT_DAYS: Record<string, number> = {
  m: 0,
  min: 0,
  minute: 0,
  h: 0,
  hr: 0,
  hour: 0,
  d: 1,
  day: 1,
  w: 7,
  wk: 7,
  week: 7,
  mo: 30,
  month: 30,
  y: 365,
  yr: 365,
  year: 365,
};

export function parseRelativeDate(text: string, now: Date): string | undefined {
  const lower = text.toLowerCase();
  if (/\b(just now|today|just posted|new)\b/.test(lower) && !/\d/.test(lower))
    return formatLocalDate(now);
  if (/\byesterday\b/.test(lower)) return formatLocalDate(addDays(now, -1));
  const m =
    /(\d+)\+?\s*(minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|wks?|w|months?|mo|years?|yrs?|y)\b\s*ago/.exec(
      lower,
    );
  if (!m) return undefined;
  const unit = (m[2] ?? '').replace(/s$/, '');
  const days = UNIT_DAYS[unit];
  if (days === undefined) return undefined;
  return formatLocalDate(addDays(now, -Number(m[1]) * days));
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatLocalDate(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
