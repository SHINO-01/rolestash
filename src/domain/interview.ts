import { calendarFile, interviewEvent } from './calendar';
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

/**
 * An .ics file for "Add to calendar". Exact times are written in UTC;
 * floating times stay floating, so the calendar shows them as written.
 * Undefined when the interview has no time yet.
 */
export function interviewCalendarFile(job: Job, now: Date): string | undefined {
  const event = interviewEvent(job);
  return event ? calendarFile([event], now) : undefined;
}
