import type { Job } from './job';
import { findStage, type Stage } from './stage';

/**
 * Follow-up reminders and closing-date alerts (Pro; ADR-0015). Pure rules:
 * the background worker asks these what to notify about, and records what
 * it has sent in a small `reminders` state record (not on the jobs, so
 * reminders never add timeline noise).
 */

/** Days ahead the "closing soon" digest looks. */
export const CLOSING_SOON_DAYS = 3;
/** The digest goes out once per local day, from this hour on. */
export const DIGEST_HOUR = 9;
const DAY_MS = 86_400_000;

export interface ReminderState {
  /** Local date (YYYY-MM-DD) of the last closing digest. */
  lastDigest?: string;
  /** jobId → the followUpAt we last notified for, so a new date notifies again. */
  notified: Record<string, string>;
}

export const EMPTY_REMINDER_STATE: ReminderState = { notified: {} };

export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Follow-ups that are due now and haven't been notified for this date yet. */
export function dueFollowUps(jobs: readonly Job[], state: ReminderState, now: Date): Job[] {
  return jobs.filter(
    (job) =>
      job.followUpAt !== undefined &&
      !job.archivedAt &&
      Date.parse(job.followUpAt) <= now.getTime() &&
      state.notified[job.id] !== job.followUpAt,
  );
}

/** Whole days from today until `closesAt` (0 = closes today), in local time. */
export function daysUntilClose(closesAt: string, now: Date): number {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(closesAt)
    ? new Date(`${closesAt}T00:00:00`)
    : new Date(closesAt);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((startOf(date) - startOf(now)) / DAY_MS);
}

/**
 * Jobs you haven't applied to yet that close within CLOSING_SOON_DAYS,
 * soonest first. Finished, archived and already-applied jobs are skipped.
 */
export function closingSoon(jobs: readonly Job[], stages: readonly Stage[], now: Date): Job[] {
  return jobs
    .filter((job) => {
      if (!job.closesAt || job.archivedAt || job.appliedAt) return false;
      const stage = findStage(stages, job.stageId);
      if (stage?.kind !== 'active' || stage.marksApplied) return false;
      const days = daysUntilClose(job.closesAt, now);
      return days >= 0 && days <= CLOSING_SOON_DAYS;
    })
    .sort((a, b) => (a.closesAt ?? '').localeCompare(b.closesAt ?? ''));
}

/** Is it time for today's digest? Once per local day, from DIGEST_HOUR. */
export function digestDue(state: ReminderState, now: Date): boolean {
  return now.getHours() >= DIGEST_HOUR && state.lastDigest !== localDay(now);
}

/** "today", "tomorrow" or "in 3 days". */
export function closesIn(days: number): string {
  return days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${String(days)} days`;
}

/** Drops notified entries for jobs that no longer exist or no longer have that date. */
export function pruneNotified(state: ReminderState, jobs: readonly Job[]): ReminderState {
  const live = new Map(jobs.map((j) => [j.id, j.followUpAt]));
  return {
    ...state,
    notified: Object.fromEntries(
      Object.entries(state.notified).filter(([id, at]) => live.get(id) === at),
    ),
  };
}

/** A follow-up `days` from today at DIGEST_HOUR local time, as an ISO instant. */
export function followUpInDays(days: number, now: Date): string {
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + days,
    DIGEST_HOUR,
  ).toISOString();
}

/** A follow-up on a picked calendar date (YYYY-MM-DD) at DIGEST_HOUR local time. */
export function followUpOn(day: string): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), DIGEST_HOUR).toISOString();
}
