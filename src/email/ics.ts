import { formatFloating, resolveTimeZone, zonedToInstant, type WallTime } from './time';

/**
 * A minimal iCalendar (RFC 5545) reader: just the first VEVENT of an invite,
 * which is all an interview invite needs.
 */

export interface CalendarInvite {
  method?: string;
  summary?: string;
  start?: string;
  end?: string;
  floating: boolean;
  timeZone?: string;
  location?: string;
  description?: string;
  url?: string;
  /** Conference link from vendor properties (Google, Microsoft). */
  conferenceUrl?: string;
  allDay: boolean;
}

interface Property {
  name: string;
  params: Record<string, string>;
  value: string;
}

function unfold(ics: string): string[] {
  return ics
    .replace(/\r\n?/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
}

function parseLine(line: string): Property | undefined {
  // NAME;PARAM=a;PARAM="b:c":VALUE: the first colon outside quotes ends the name.
  let inQuotes = false;
  let split = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ':' && !inQuotes) {
      split = i;
      break;
    }
  }
  if (split < 0) return undefined;
  const [name = '', ...rawParams] = line.slice(0, split).split(';');
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value: line.slice(split + 1) };
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\([,;\\])/g, '$1')
    .trim();
}

interface ParsedTime {
  iso: string;
  floating: boolean;
  timeZone?: string;
  allDay: boolean;
}

function parseTime(prop: Property): ParsedTime | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(prop.value.trim());
  if (!m) return undefined;
  const wall: WallTime = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4] ?? 0),
    minute: Number(m[5] ?? 0),
    second: Number(m[6] ?? 0),
  };
  if (m[4] === undefined || prop.params.VALUE === 'DATE') {
    return { iso: formatFloating(wall).slice(0, 10), floating: true, allDay: true };
  }
  if (m[7] === 'Z') {
    const utc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
    return { iso: new Date(utc).toISOString(), floating: false, timeZone: 'UTC', allDay: false };
  }
  const zone = resolveTimeZone(prop.params.TZID);
  if (zone) {
    return {
      iso: zonedToInstant(wall, zone).toISOString(),
      floating: false,
      timeZone: zone,
      allDay: false,
    };
  }
  return { iso: formatFloating(wall), floating: true, allDay: false };
}

export function parseCalendar(ics: string): CalendarInvite | undefined {
  const lines = unfold(ics);
  let method: string | undefined;
  let depth = 0;
  let inEvent = false;
  let event: Property[] | undefined;
  for (const line of lines) {
    const prop = parseLine(line);
    if (!prop) continue;
    if (prop.name === 'BEGIN') {
      depth++;
      if (prop.value.toUpperCase() === 'VEVENT' && !event) {
        inEvent = true;
        event = [];
      }
      continue;
    }
    if (prop.name === 'END') {
      depth--;
      if (prop.value.toUpperCase() === 'VEVENT') inEvent = false;
      continue;
    }
    if (prop.name === 'METHOD' && depth === 1) method = prop.value.trim().toUpperCase();
    else if (inEvent && event && depth === 2) event.push(prop);
  }
  if (!event) return undefined;

  const get = (name: string): Property | undefined => event.find((p) => p.name === name);
  const start = get('DTSTART');
  const startTime = start ? parseTime(start) : undefined;
  const endProp = get('DTEND');
  const endTime = endProp ? parseTime(endProp) : undefined;
  const text = (name: string): string | undefined => {
    const v = get(name)?.value;
    return v ? unescapeText(v) || undefined : undefined;
  };

  return {
    method,
    summary: text('SUMMARY'),
    start: startTime?.iso,
    end: endTime?.iso,
    floating: startTime?.floating ?? true,
    timeZone: startTime?.timeZone,
    location: text('LOCATION'),
    description: text('DESCRIPTION'),
    url: text('URL'),
    conferenceUrl:
      text('X-GOOGLE-CONFERENCE') ??
      text('X-MICROSOFT-SKYPETEAMSMEETINGURL') ??
      text('X-MICROSOFT-ONLINEMEETINGCONFLINK'),
    allDay: startTime?.allDay ?? false,
  };
}
