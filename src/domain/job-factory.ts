import type {
  Activity,
  EmailNote,
  ExtractionMeta,
  Job,
  JobInterview,
  JobPatch,
  JobSource,
  Posting,
  Suggestion,
} from './job';
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
    // Reordering is a change too, so it syncs (ADR-0016).
    return job.rank === rank ? job : { ...job, rank, updatedAt: ctx.now().toISOString() };
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

// ── Email updates (Advanced; ADR-0014) ─────────────────────────────────────

export interface EmailUpdate {
  /** Column to move to, with its rank there; omitted when the job stays put. */
  to?: { stage: Stage; rank: number };
  interview?: JobInterview;
  email: EmailNote;
}

/**
 * Applies an update from an email: a move and/or the next interview, with an
 * `email_update` entry naming the email. Clears any pending suggestion,
 * which this supersedes. Returns the job unchanged when nothing would change.
 */
export function applyEmailUpdate(job: Job, update: EmailUpdate, ctx: DomainContext): Job {
  const moves = update.to !== undefined && update.to.stage.id !== job.stageId;
  const interview =
    update.interview && !isEqual(update.interview, job.interview) ? update.interview : undefined;
  if (!moves && !interview) return job.suggestion ? clearSuggestion(job, ctx) : job;

  const at = ctx.now().toISOString();
  const entry: Activity = { id: ctx.newId(), at, type: 'email_update', email: update.email };
  const { suggestion: _suggestion, ...rest } = job;
  const next: Job = { ...rest, updatedAt: at };
  if (moves && update.to) {
    entry.fromStageId = job.stageId;
    entry.toStageId = update.to.stage.id;
    next.stageId = update.to.stage.id;
    next.rank = update.to.rank;
    if (update.to.stage.marksApplied && !job.appliedAt) next.appliedAt = at;
  }
  if (interview) {
    next.interview = interview;
    entry.setInterview = true;
  }
  next.activity = [...job.activity, entry];
  return next;
}

/** Puts a lower-confidence update on the card for the user to decide. */
export function setSuggestion(job: Job, suggestion: Suggestion, ctx: DomainContext): Job {
  return { ...job, suggestion, updatedAt: ctx.now().toISOString() };
}

export function clearSuggestion(job: Job, ctx: DomainContext): Job {
  if (!job.suggestion) return job;
  const { suggestion: _suggestion, ...rest } = job;
  return { ...rest, updatedAt: ctx.now().toISOString() };
}

/**
 * Undoes an email update: moves the job back to where it was (when it's
 * still where the update put it) and removes the interview it set. The entry
 * stays in the timeline, marked undone. Returns the job unchanged when the
 * entry can't be undone.
 */
export function undoEmailUpdate(
  job: Job,
  activityId: string,
  back: { stage: Stage; rank: number } | undefined,
  ctx: DomainContext,
): Job {
  const entry = job.activity.find((a) => a.id === activityId);
  if (entry?.type !== 'email_update' || entry.undone) return job;
  const at = ctx.now().toISOString();
  let next: Job = {
    ...job,
    updatedAt: at,
    activity: job.activity.map((a) => (a.id === activityId ? { ...a, undone: true } : a)),
  };
  if (entry.setInterview && next.interview) {
    const { interview: _interview, ...rest } = next;
    next = rest;
  }
  if (back && entry.toStageId === job.stageId && back.stage.id === entry.fromStageId) {
    next = {
      ...next,
      stageId: back.stage.id,
      rank: back.rank,
      activity: [
        ...next.activity,
        {
          id: ctx.newId(),
          at,
          type: 'stage_changed',
          fromStageId: job.stageId,
          toStageId: back.stage.id,
        },
      ],
    };
  }
  return next;
}
