import { z } from 'zod';

/**
 * A board column. Stages are *data*, not code: they live in settings so a
 * future "customise columns" feature needs no schema migration.
 */
export const STAGE_COLORS = ['slate', 'sky', 'violet', 'amber', 'emerald', 'rose', 'zinc'] as const;
export type StageColor = (typeof STAGE_COLORS)[number];

/**
 * - `active`   the application is still in play
 * - `won`      a positive terminal state (offer)
 * - `lost`     a negative terminal state (rejected). Lost columns have no
 *              lane on the board (ADR-0034): jobs are moved there from the
 *              job drawer, bulk "Move to" or the web board's job sheet.
 */
export const STAGE_KINDS = ['active', 'won', 'lost'] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export const StageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(40),
  color: z.enum(STAGE_COLORS),
  kind: z.enum(STAGE_KINDS),
  /** When true, moving a job into this stage stamps `appliedAt` if unset. */
  marksApplied: z.boolean().default(false),
  /** Hidden from the board and pickers, kept so old jobs and History still name it. */
  archived: z.boolean().optional(),
});
export type Stage = z.infer<typeof StageSchema>;
export type StageId = Stage['id'];

export const DEFAULT_STAGES: readonly Stage[] = [
  { id: 'saved', name: 'Saved', color: 'slate', kind: 'active', marksApplied: false },
  { id: 'applied', name: 'Applied', color: 'sky', kind: 'active', marksApplied: true },
  { id: 'interviewing', name: 'Interviewing', color: 'amber', kind: 'active', marksApplied: true },
  { id: 'offer', name: 'Offer', color: 'emerald', kind: 'won', marksApplied: true },
  { id: 'rejected', name: 'Rejected', color: 'rose', kind: 'lost', marksApplied: false },
];

export const DEFAULT_STAGE_ID: StageId = 'saved';

/** The columns offered in pickers (job drawer, bulk "Move to", the web board's job sheet). */
export function visibleStages(stages: readonly Stage[]): Stage[] {
  return stages.filter((s) => !s.archived);
}

/** The columns that get a lane on the board: every visible one, Rejected included. */
export function laneStages(stages: readonly Stage[]): Stage[] {
  return visibleStages(stages);
}

/**
 * Where a new job can start (the widget's chips, the capture form, Add job):
 * the lanes without the `lost` ones; nobody saves a job straight into Rejected.
 */
export function captureStages(stages: readonly Stage[]): Stage[] {
  return stages.filter((s) => !s.archived && s.kind !== 'lost');
}

/**
 * Default columns retired in 0.5.0 (ADR-0034), with where their jobs went.
 * Devices still on 0.4.7 keep syncing these ids for a while, so they're
 * mapped on every read, not only by the one-time migration.
 */
export const RETIRED_STAGES: Readonly<Record<string, { alias: StageId; name: string }>> = {
  screening: { alias: 'interviewing', name: 'Screening' },
  withdrawn: { alias: 'rejected', name: 'Withdrawn' },
};

/** The column a retired id now maps to, or undefined for a current id. */
export function retiredStageAlias(id: StageId): StageId | undefined {
  return Object.hasOwn(RETIRED_STAGES, id) ? RETIRED_STAGES[id]?.alias : undefined;
}

/** A column's name, including retired ones that old history entries still name. */
export function stageName(stages: readonly Stage[], id: StageId | undefined): string {
  if (id === undefined) return '—';
  return (
    findStage(stages, id)?.name ??
    (Object.hasOwn(RETIRED_STAGES, id) ? RETIRED_STAGES[id]?.name : undefined) ??
    id
  );
}

export function findStage(stages: readonly Stage[], id: StageId): Stage | undefined {
  return stages.find((s) => s.id === id);
}
