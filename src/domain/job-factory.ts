import type { Activity, ExtractionMeta, Job, JobPatch, JobSource, Posting } from './job';
import type { Stage } from './stage';

/**
 * Pure state transitions for the Job aggregate. Every function takes the
 * current time and an id generator explicitly so behaviour is deterministic
 * and trivially testable; the service layer supplies real implementations.
 */

export interface DomainContext {
  now: () => Date;
  newId: () => string;
}

export interface NewJobInput {
  posting: Posting;
  source: JobSource;
  stage: Stage;
  rank: number;
  extraction?: ExtractionMeta;
  priority?: Job['priority'];
  tags?: string[];
  notes?: string;
}

export function createJob(input: NewJobInput, ctx: DomainContext): Job {
  const at = ctx.now().toISOString();
  const job: Job = {
    ...input.posting,
    id: ctx.newId(),
    stageId: input.stage.id,
    rank: input.rank,
    priority: input.priority ?? 0,
    tags: input.tags ?? [],
    notes: input.notes ?? '',
    source: input.source,
    activity: [{ id: ctx.newId(), at, type: 'created', toStageId: input.stage.id }],
    createdAt: at,
    updatedAt: at,
  };
  if (input.extraction) job.extraction = input.extraction;
  if (input.stage.marksApplied) job.appliedAt = at;
  return job;
}

export function moveJob(job: Job, to: Stage, rank: number, ctx: DomainContext): Job {
  if (job.stageId === to.id) {
    return job.rank === rank ? job : { ...job, rank };
  }
  const at = ctx.now().toISOString();
  const entry: Activity = {
    id: ctx.newId(),
    at,
    type: 'stage_changed',
    fromStageId: job.stageId,
    toStageId: to.id,
  };
  const next: Job = {
    ...job,
    stageId: to.id,
    rank,
    updatedAt: at,
    activity: [...job.activity, entry],
  };
  if (to.marksApplied && !job.appliedAt) next.appliedAt = at;
  return next;
}

/** Takes a job off the board into History. Idempotent. */
export function archiveJob(job: Job, ctx: DomainContext): Job {
  if (job.archivedAt) return job;
  const at = ctx.now().toISOString();
  return {
    ...job,
    archivedAt: at,
    updatedAt: at,
    activity: [...job.activity, { id: ctx.newId(), at, type: 'archived' }],
  };
}

/** Puts an archived job back on the board, in the same column. Idempotent. */
export function unarchiveJob(job: Job, ctx: DomainContext): Job {
  if (!job.archivedAt) return job;
  const at = ctx.now().toISOString();
  const { archivedAt: _archivedAt, ...rest } = job;
  return {
    ...rest,
    updatedAt: at,
    activity: [...job.activity, { id: ctx.newId(), at, type: 'unarchived' }],
  };
}

/**
 * Apply a user edit. Consecutive edits within `EDIT_COALESCE_MS` are merged
 * into one activity entry so typing notes doesn't flood the timeline.
 */
const EDIT_COALESCE_MS = 5 * 60 * 1000;

export function updateJob(job: Job, patch: JobPatch, ctx: DomainContext): Job {
  const changed = (Object.keys(patch) as (keyof JobPatch)[]).filter(
    (key) => !isEqual(job[key], patch[key]),
  );
  if (changed.length === 0) return job;

  const now = ctx.now();
  const at = now.toISOString();
  // Explicit `undefined` in a patch clears an optional field.
  const cleared = new Set<string>(changed.filter((key) => patch[key] === undefined));
  const next = Object.fromEntries(
    Object.entries({ ...job, ...stripUndefined(patch), updatedAt: at }).filter(
      ([key]) => !cleared.has(key),
    ),
  ) as Job;

  const last = job.activity.at(-1);
  const coalesce =
    last?.type === 'edited' && now.getTime() - new Date(last.at).getTime() < EDIT_COALESCE_MS;
  if (coalesce) {
    const fields = Array.from(new Set([...(last.fields ?? []), ...changed]));
    next.activity = [...job.activity.slice(0, -1), { ...last, at, fields }];
  } else {
    next.activity = [...job.activity, { id: ctx.newId(), at, type: 'edited', fields: changed }];
  }
  return next;
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function isEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
