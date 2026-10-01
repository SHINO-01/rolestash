/**
 * Times in emails: IANA zone resolution with `Intl` (no tz database bundled),
 * and dates written in text ("Thursday 3 October at 10am AEST", "tomorrow at
 * 2pm"), resolved relative to the email's own Date header.
 */

/** A wall-clock time, before any zone is applied. */
export interface WallTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second?: number;
}

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Offset of `zone` from UTC at `instant`, in minutes. */
export function zoneOffsetMinutes(instant: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(instant));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / 60_000);
}

/** The instant a wall time in `zone` refers to (DST gaps resolve forwards). */
export function zonedToInstant(wall: WallTime, zone: string): Date {
  const guess = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second ?? 0,
  );
  let offset = zoneOffsetMinutes(guess, zone);
  let instant = guess - offset * 60_000;
  const second = zoneOffsetMinutes(instant, zone);
  if (second !== offset) {
    offset = second;
    instant = guess - offset * 60_000;
  }
  return new Date(instant);
}

/** Local wall time as an ISO string without an offset (a "floating" time). */
export function formatFloating(wall: WallTime): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${p(wall.year, 4)}-${p(wall.month)}-${p(wall.day)}T${p(wall.hour)}:${p(wall.minute)}:${p(wall.second ?? 0)}`;
}

/**
 * Common abbreviations → IANA zones. People write "AEST" all year, including
 * during daylight saving, so Australian abbreviations map to the city zone
 * and the wall time is read there.
 */
export const TZ_ABBREVIATIONS: Record<string, string> = {
  AEST: 'Australia/Sydney',
  AEDT: 'Australia/Sydney',
  AET: 'Australia/Sydney',
  ACST: 'Australia/Adelaide',
  ACDT: 'Australia/Adelaide',
  AWST: 'Australia/Perth',
  NZST: 'Pacific/Auckland',
  NZDT: 'Pacific/Auckland',
  NZT: 'Pacific/Auckland',
  UTC: 'UTC',
  GMT: 'Europe/London',
  BST: 'Europe/London',
  CET: 'Europe/Paris',
  CEST: 'Europe/Paris',
  EST: 'America/New_York',
  EDT: 'America/New_York',
  ET: 'America/New_York',
  CST: 'America/Chicago',
  CDT: 'America/Chicago',
  CT: 'America/Chicago',
  MST: 'America/Denver',
  MDT: 'America/Denver',
  MT: 'America/Denver',
  PST: 'America/Los_Angeles',
  PDT: 'America/Los_Angeles',
  PT: 'America/Los_Angeles',
  IST: 'Asia/Kolkata',
  SGT: 'Asia/Singapore',
  HKT: 'Asia/Hong_Kong',
  JST: 'Asia/Tokyo',
};

/** Windows zone names that Outlook writes into calendar invites. */
const WINDOWS_ZONES: Record<string, string> = {
  'aus eastern standard time': 'Australia/Sydney',
  'e. australia standard time': 'Australia/Brisbane',
  'cen. australia standard time': 'Australia/Adelaide',
  'aus central standard time': 'Australia/Darwin',
  'w. australia standard time': 'Australia/Perth',
  'tasmania standard time': 'Australia/Hobart',
  'new zealand standard time': 'Pacific/Auckland',
  'gmt standard time': 'Europe/London',
  'w. europe standard time': 'Europe/Berlin',
  'romance standard time': 'Europe/Paris',
  'eastern standard time': 'America/New_York',
  'central standard time': 'America/Chicago',
  'mountain standard time': 'America/Denver',
  'pacific standard time': 'America/Los_Angeles',
  'india standard time': 'Asia/Kolkata',
  'singapore standard time': 'Asia/Singapore',
  'tokyo standard time': 'Asia/Tokyo',
  utc: 'UTC',
};

/** Resolves a calendar TZID or a written zone to an IANA name `Intl` knows. */
export function resolveTimeZone(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const trimmed = name.trim().replace(/^"|"$/g, '');
  const windows = WINDOWS_ZONES[trimmed.toLowerCase()];
  if (windows) return windows;
  const abbreviation = TZ_ABBREVIATIONS[trimmed.toUpperCase()];
  if (abbreviation) return abbreviation;
  // "/mozilla.org/20050126_1/Australia/Sydney" and similar prefixes.
  const segments = trimmed.split('/').filter(Boolean);
  for (let i = 0; i < segments.length; i++) {
    const candidate = segments.slice(i).join('/');
    if (/^[A-Za-z_]+(?:\/[A-Za-z_+-]+)+$|^UTC$/.test(candidate) && isValidTimeZone(candidate))
      return candidate;
  }
  return undefined;
}

// ── Dates written in text ──────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const MONTH =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const WEEKDAY = '(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?\\.?';
const DAY = '(\\d{1,2})(?:st|nd|rd|th)?';
const TIME = '(\\d{1,2})(?:[:.](\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)?';
const ZONE_WORDS = Object.keys(TZ_ABBREVIATIONS).join('|');
const ZONE = `(?:\\(?\\s*(${ZONE_WORDS}|[A-Z][a-z]+/[A-Za-z_]+)\\b\\)?)?`;
const TIME_RANGE = `${TIME}(?:\\s*(?:-|–|—|to|until)\\s*${TIME})?\\s*${ZONE}`;

export interface TextDateTime {
  start: string;
  end?: string;
  floating: boolean;
  timeZone?: string;
  /** Index in the text where the match started. */
  index: number;
}

interface DateParts {
  year: number;
  month: number;
  day: number;
}

function toHour(hour: number, meridiem: string | undefined): number | undefined {
  const m = meridiem?.replace(/\./g, '').toLowerCase();
  if (hour > 23) return undefined;
  if (m === 'pm' && hour < 12) return hour + 12;
  if (m === 'am' && hour === 12) return 0;
  if (!m && hour > 0 && hour < 7) return hour + 12; // "at 2" in an invite means 2pm
  return hour;
}

/** The email's local calendar date, read from its own offset when it has one. */
function localDateOf(emailDate: string): DateParts & { weekday: number } {
  const instant = new Date(emailDate);
  const offset = /([+-])(\d{2}):?(\d{2})$/.exec(emailDate);
  const minutes = offset
    ? (offset[1] === '-' ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3]))
    : 0;
  const local = new Date(instant.getTime() + minutes * 60_000);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    weekday: local.getUTCDay(),
  };
}

function addDays(d: DateParts, days: number): DateParts {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

function validDay(d: DateParts): boolean {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day));
  return t.getUTCMonth() === d.month - 1 && t.getUTCDate() === d.day;
}

/** A date without a year is the next occurrence on or after the email's date. */
function inferYear(month: number, day: number, ref: DateParts): number {
  const sameYear = Date.UTC(ref.year, month - 1, day);
  const refTime = Date.UTC(ref.year, ref.month - 1, ref.day);
  return sameYear >= refTime - 86_400_000 ? ref.year : ref.year + 1;
}

function finish(
  date: DateParts,
  groups: (string | undefined)[],
  index: number,
): TextDateTime | undefined {
  const [h1, m1, ap1, h2, m2, ap2, zone] = groups;
  const startHour = toHour(Number(h1), ap1 ?? ap2);
  if (startHour === undefined || (!ap1 && !ap2 && m1 === undefined)) return undefined;
  if (!validDay(date)) return undefined;
  const startWall = { ...date, hour: startHour, minute: Number(m1 ?? 0) };
  let endWall: typeof startWall | undefined;
  if (h2 !== undefined) {
    const endHour = toHour(Number(h2), ap2 ?? ap1);
    if (endHour !== undefined) endWall = { ...date, hour: endHour, minute: Number(m2 ?? 0) };
  }
  const timeZone = resolveTimeZone(zone);
  if (timeZone) {
    return {
      start: zonedToInstant(startWall, timeZone).toISOString(),
      end: endWall ? zonedToInstant(endWall, timeZone).toISOString() : undefined,
      floating: false,
      timeZone,
      index,
    };
  }
  return {
    start: formatFloating(startWall),
    end: endWall ? formatFloating(endWall) : undefined,
    floating: true,
    index,
  };
}

/**
 * Finds the first date *with a time* in `text`. Dates without a time are not
 * interview times, so they are skipped.
 */
export function findDateTime(text: string, emailDate: string): TextDateTime | undefined {
  const ref = localDateOf(emailDate);
  const sep = '\\s*,?\\s*(?:at|@|from|,|-|–)?\\s*';
  const found: TextDateTime[] = [];

  // "Thursday 3 October 2026 at 10am AEST", "3rd Oct, 10:00-11:00"
  const dayMonth = new RegExp(
    `(?:${WEEKDAY}\\s*,?\\s*)?\\b${DAY}\\s+(?:of\\s+)?${MONTH}(?:\\s*,?\\s*(\\d{4}))?${sep}${TIME_RANGE}`,
    'gi',
  );
  for (const m of text.matchAll(dayMonth)) {
    const month = MONTHS[(m[2] ?? '').toLowerCase().slice(0, 3)];
    if (!month) continue;
    const day = Number(m[1]);
    const year = m[3] ? Number(m[3]) : inferYear(month, day, ref);
    const r = finish({ year, month, day }, m.slice(4, 11), m.index);
    if (r) found.push(r);
  }

  // "Thursday, October 3 at 10:00 AM PT", "Oct 3rd, 2026, 2:30 pm"
  const monthDay = new RegExp(
    `(?:${WEEKDAY}\\s*,?\\s*)?\\b${MONTH}\\s+${DAY}(?:\\s*,?\\s*(\\d{4}))?${sep}${TIME_RANGE}`,
    'gi',
  );
  for (const m of text.matchAll(monthDay)) {
    const month = MONTHS[(m[1] ?? '').toLowerCase().slice(0, 3)];
    if (!month) continue;
    const day = Number(m[2]);
    const year = m[3] ? Number(m[3]) : inferYear(month, day, ref);
    const r = finish({ year, month, day }, m.slice(4, 11), m.index);
    if (r) found.push(r);
  }

  // "2026-10-03 10:00"
  const iso = new RegExp(`\\b(\\d{4})-(\\d{2})-(\\d{2})(?:T|\\s+(?:at\\s+)?)${TIME_RANGE}`, 'gi');
  for (const m of text.matchAll(iso)) {
    const r = finish(
      { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) },
      m.slice(4, 11),
      m.index,
    );
    if (r) found.push(r);
  }

  // "tomorrow at 2pm", "today at 3:30pm", "next Tuesday at 11am", "on Monday at 9:30"
  const relative = new RegExp(
    `\\b(today|tomorrow|(?:this\\s+|next\\s+|on\\s+)?(${WEEKDAY}))${sep}${TIME_RANGE}`,
    'gi',
  );
  for (const m of text.matchAll(relative)) {
    const word = (m[1] ?? '').toLowerCase();
    let date: DateParts;
    if (word === 'today') date = ref;
    else if (word === 'tomorrow') date = addDays(ref, 1);
    else {
      const name = (m[2] ?? '').toLowerCase().replace(/\.$/, '');
      const target = WEEKDAYS.findIndex((w) => w.startsWith(name.slice(0, 3)));
      if (target < 0) continue;
      let ahead = (target - ref.weekday + 7) % 7;
      if (ahead === 0) ahead = 7;
      date = addDays(ref, ahead);
    }
    const r = finish(date, m.slice(3, 10), m.index);
    if (r) found.push(r);
  }

  found.sort((a, b) => a.index - b.index);
  return found[0];
}
