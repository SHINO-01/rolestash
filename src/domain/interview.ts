import type { Job, JobInterview } from './job';

/**
 * Interview helpers for the card (ADR-0014 §4): when it is, an "Add to
 * calendar" file, and a map link. Pure: the UI downloads the file and opens
 * the links; nothing here touches the network.
 */

/** The interview's start as a Date: an exact instant, or a floating time read in this zone. */
export function interviewStart(interview: JobInterview | undefined): Date | undefined {
  if (!interview?.start) return undefined;
  // ISO without an offset parses as local time, which is what floating means.
  const date = new Date(interview.start);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function interviewEnd(interview: JobInterview): Date | undefined {
  if (!interview.end) return undefined;
  const date = new Date(interview.end);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Upcoming or within the last few hours (so a card doesn't drop it mid-interview). */
export function isUpcoming(interview: JobInterview | undefined, now: Date): boolean {
  const start = interviewStart(interview);
  return start !== undefined && start.getTime() > now.getTime() - 3 * 3_600_000;
}

/** A plain Google Maps search link the user clicks; no Maps API, no request from us. */
export function mapsUrl(location: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

/** True when the location is a place, not a link or a video-call note. */
export function isPhysicalLocation(location: string | undefined): location is string {
  return (
    location !== undefined &&
    !/^https?:\/\//i.test(location) &&
    !/^(?:online|remote|virtual|video call|phone|zoom|google meet|microsoft teams|teams|webex)$/i.test(
      location.trim(),
    )
  );
}

const pad = (n: number): string => String(n).padStart(2, '0');

function icsUtc(date: Date): string {
  return `${String(date.getUTCFullYear())}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function icsFloating(date: Date): string {
  return `${String(date.getFullYear())}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function icsText(value: string): string {
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

/**
 * An .ics file for "Add to calendar". Exact times are written in UTC;
 * floating times stay floating, so the calendar shows them as written.
 * Undefined when the interview has no time yet.
 */
export function interviewCalendarFile(job: Job, now: Date): string | undefined {
  const interview = job.interview;
  const start = interviewStart(interview);
  if (!interview || !start) return undefined;
  const end = interviewEnd(interview) ?? new Date(start.getTime() + 3_600_000);
  const when = interview.floating ? icsFloating : icsUtc;
  const title = job.company
    ? `Interview: ${job.title} at ${job.company}`
    : `Interview: ${job.title}`;
  const details = [
    interview.meetingUrl ? `Join: ${interview.meetingUrl}` : undefined,
    'Added from Rolestash',
  ].filter(Boolean);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Rolestash//Interview//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${job.id}-interview@rolestash.com`,
    `DTSTAMP:${icsUtc(now)}`,
    `DTSTART:${when(start)}`,
    `DTEND:${when(end)}`,
    `SUMMARY:${icsText(title)}`,
    ...(interview.location ? [`LOCATION:${icsText(interview.location)}`] : []),
    ...(interview.meetingUrl ? [`URL:${interview.meetingUrl}`] : []),
    `DESCRIPTION:${icsText(details.join('\n'))}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
