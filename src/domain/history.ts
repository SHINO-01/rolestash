import type { Activity, Job } from './job';
import type { Plan } from './plan';
import { findStage, type Stage } from './stage';

/**
 * History rules (ADR-0013). Free shows finished (won/lost) and archived jobs,
 * and timeline entries, from the last 30 days; Pro show
 * everything. Nothing is deleted: older items are only hidden, and exports
 * always contain everything.
 */

export const FREE_HISTORY_DAYS = 30;
const DAY_MS = 86_400_000;

/**
 * Where history starts for a plan: a cutoff on Free, none on paid plans.
 * `undefined` plan means a build without accounts, where nothing is limited
 * because there's no way to upgrade (as with job limits).
 */
export function historyStart(plan: Plan | undefined, now: Date): Date | undefined {
  return plan === 'free' ? new Date(now.getTime() - FREE_HISTORY_DAYS * DAY_MS) : undefined;
}

export function isFinished(job: Job, stages: readonly Stage[]): boolean {
  const kind = findStage(stages, job.stageId)?.kind;
  return kind === 'won' || kind === 'lost';
}

/** When the job reached its current (finished) stage: its last move there, else creation. */
export function finishedAt(job: Job): string {
  const moves = job.activity.filter(
    (a) =>
      (a.type === 'stage_changed' || (a.type === 'email_update' && !a.undone)) &&
      a.toStageId === job.stageId,
  );
  return moves.at(-1)?.at ?? job.createdAt;
}

/** The date History sorts and windows a job by, or undefined if it's not history yet. */
export function historyDate(job: Job, stages: readonly Stage[]): string | undefined {
  if (job.archivedAt) return job.archivedAt;
  return isFinished(job, stages) ? finishedAt(job) : undefined;
}

const within = (iso: string, start: Date | undefined) =>
  start === undefined || Date.parse(iso) >= start.getTime();

export interface BoardView {
  /** Jobs to show as cards. */
  board: Job[];
  /** Finished jobs older than the plan's history, hidden from the board. */
  hidden: number;
}

/** The board: every job that isn't archived, minus finished ones beyond the window. */
export function boardView(jobs: readonly Job[], stages: readonly Stage[], start?: Date): BoardView {
  const board: Job[] = [];
  let hidden = 0;
  for (const job of jobs) {
    if (job.archivedAt) continue;
    if (isFinished(job, stages) && !within(finishedAt(job), start)) hidden++;
    else board.push(job);
  }
  return { board, hidden };
}

export type HistoryTab = 'finished' | 'archived';

export interface HistoryView {
  jobs: Job[];
  /** Items beyond the plan's history window. */
  hidden: number;
}

/** History: finished or archived jobs, newest first, within the window. */
export function historyView(
  jobs: readonly Job[],
  stages: readonly Stage[],
  tab: HistoryTab,
  start?: Date,
): HistoryView {
  const inTab = jobs.filter((job) =>
    tab === 'archived' ? job.archivedAt !== undefined : !job.archivedAt && isFinished(job, stages),
  );
  const dated = inTab.map((job) => ({ job, at: historyDate(job, stages) ?? job.updatedAt }));
  const shown = dated.filter((d) => within(d.at, start)).sort((a, b) => b.at.localeCompare(a.at));
  return { jobs: shown.map((d) => d.job), hidden: dated.length - shown.length };
}

/** Timeline entries within the window, newest first. */
export function visibleActivity(
  activity: readonly Activity[],
  start?: Date,
): { items: Activity[]; hidden: number } {
  const items = activity.filter((a) => within(a.at, start)).reverse();
  return { items, hidden: activity.length - items.length };
}
