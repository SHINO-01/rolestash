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
 * - `lost`     a negative terminal state (rejected / withdrawn)
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
  { id: 'screening', name: 'Screening', color: 'violet', kind: 'active', marksApplied: true },
  { id: 'interviewing', name: 'Interviewing', color: 'amber', kind: 'active', marksApplied: true },
  { id: 'offer', name: 'Offer', color: 'emerald', kind: 'won', marksApplied: true },
  { id: 'rejected', name: 'Rejected', color: 'rose', kind: 'lost', marksApplied: false },
  { id: 'withdrawn', name: 'Withdrawn', color: 'zinc', kind: 'lost', marksApplied: false },
];

export const DEFAULT_STAGE_ID: StageId = 'saved';

/** The columns shown on the board and offered in pickers. */
export function visibleStages(stages: readonly Stage[]): Stage[] {
  return stages.filter((s) => !s.archived);
}

export function findStage(stages: readonly Stage[], id: StageId): Stage | undefined {
  return stages.find((s) => s.id === id);
}
