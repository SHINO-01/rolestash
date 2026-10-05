import { interviewEnd, interviewStart } from './interview';
import type { InterviewKind, Job } from './job';

/**
 * iCalendar (RFC 5545) files built on the device: "Add to calendar" for one
 * interview, and "Export calendar" for the whole board (Pro). Events
 * carry stable UIDs, so importing again updates them instead of duplicating.
 * Notes and contacts never go into a calendar file: calendars get shared.
 */

export interface CalendarEvent {
  uid: string;
  summary: string;
  /** A timed event; `floating` writes local time without a zone. */
  start?: Date;
  end?: Date;
  floating?: boolean;
  /** An all-day event on this calendar date (YYYY-MM-DD). */
  date?: string;
  location?: string;
  url?: string;
  description?: string;
}

const pad = (n: number): string => String(n).padStart(2, '0');

function utc(date: Date): string {
  return `${String(date.getUTCFullYear())}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function floating(date: Date): string {
  return `${String(date.getFullYear())}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function text(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** RFC 5545 line folding at 74 characters. */
function fold(line: string): string {
  const parts: string[] = [];
  for (let i = 0; i < line.length; i += 74) parts.push(line.slice(i, i + 74));
  return parts.join('\r\n ');
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function eventLines(event: CalendarEvent, now: Date): string[] {
  const when: string[] = [];
  if (event.date) {
    when.push(
      `DTSTART;VALUE=DATE:${event.date.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${nextDay(event.date)}`,
    );
  } else if (event.start) {
    const format = event.floating ? floating : utc;
    const end = event.end ?? new Date(event.start.getTime() + 3_600_000);
    when.push(`DTSTART:${format(event.start)}`, `DTEND:${format(end)}`);
  }
  return [
    'BEGIN:VEVENT',
    `UID:${event.uid}@rolestash.com`,
    `DTSTAMP:${utc(now)}`,
    ...when,
    `SUMMARY:${text(event.summary)}`,
    ...(event.location ? [`LOCATION:${text(event.location)}`] : []),
    ...(event.url ? [`URL:${event.url}`] : []),
    `DESCRIPTION:${text(event.description ?? 'Added from Rolestash')}`,
    'END:VEVENT',
  ];
}

export function calendarFile(events: readonly CalendarEvent[], now: Date): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Rolestash//Board//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Rolestash',
    ...events.flatMap((e) => eventLines(e, now)),
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

const at = (job: Job) => (job.company ? `${job.title} at ${job.company}` : job.title);

export const INTERVIEW_KIND_LABEL: Record<InterviewKind, string> = {
  phone: 'Phone interview',
  video: 'Video interview',
  onsite: 'On-site interview',
  technical: 'Technical interview',
  panel: 'Panel interview',
  final: 'Final interview',
  other: 'Interview',
};

/** The interview from email updates, as an event (undefined until it has a time). */
export function interviewEvent(job: Job): CalendarEvent | undefined {
  const interview = job.interview;
  const start = interviewStart(interview);
  if (!interview || !start) return undefined;
  const end = interviewEnd(interview);
  return {
    uid: `${job.id}-interview`,
    summary: `Interview: ${at(job)}`,
    start,
    ...(end ? { end } : {}),
    floating: interview.floating,
    ...(interview.location ? { location: interview.location } : {}),
    ...(interview.meetingUrl
      ? {
          url: interview.meetingUrl,
          description: `Join: ${interview.meetingUrl}\nAdded from Rolestash`,
        }
      : {}),
  };
}

/** Every dated thing on the board, as calendar events. Archived jobs are left out. */
export function boardEvents(jobs: readonly Job[]): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const job of jobs) {
    if (job.archivedAt) continue;
    const interview = interviewEvent(job);
    if (interview) events.push(interview);
    for (const round of job.rounds ?? []) {
      if (!round.at) continue;
      events.push({
        uid: `${job.id}-round-${round.id}`,
        summary: `${INTERVIEW_KIND_LABEL[round.kind]}: ${at(job)}`,
        start: new Date(round.at),
        ...(round.with ? { description: `With ${round.with}\nAdded from Rolestash` } : {}),
      });
    }
    if (job.followUpAt) {
      const start = new Date(job.followUpAt);
      events.push({
        uid: `${job.id}-followup`,
        summary: `Follow up: ${at(job)}`,
        start,
        end: new Date(start.getTime() + 15 * 60_000),
      });
    }
    // Closing dates matter until you've applied.
    if (job.closesAt && !job.appliedAt) {
      events.push({
        uid: `${job.id}-closes`,
        summary: `Applications close: ${at(job)}`,
        date: job.closesAt.slice(0, 10),
      });
    }
  }
  return events;
}
