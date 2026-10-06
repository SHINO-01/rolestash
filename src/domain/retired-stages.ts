import type { Activity, Job } from './job';
import type { Settings } from './settings';
import { DEFAULT_STAGES, RETIRED_STAGES, retiredStageAlias, type Stage } from './stage';

/**
 * Screening and Withdrawn were retired in 0.5.0 (ADR-0034). Storage migration
 * v2 moves stored data once; these pure functions run on every read and
 * write too (repositories, sync pull, backup import, the web board), because
 * devices on 0.4.7 keep syncing the old ids for a while. Each returns its
 * input unchanged (the same object) when there's nothing to do.
 */

/** Drops the retired columns and points `defaultStageId` at a column that's left. */
export function normalizeStages(settings: Settings): Settings {
  if (!settings.stages.some((s) => Object.hasOwn(RETIRED_STAGES, s.id))) return settings;
  const kept = settings.stages.filter((s) => !Object.hasOwn(RETIRED_STAGES, s.id));
  const stages: Stage[] = [...kept];
  // Jobs from a retired column need their new column to exist.
  for (const retired of settings.stages) {
    const alias = retiredStageAlias(retired.id);
    if (!alias || stages.some((s) => s.id === alias)) continue;
    const fallback = DEFAULT_STAGES.find((s) => s.id === alias);
    if (fallback) stages.push({ ...fallback });
  }
  const live = stages.filter((s) => !s.archived);
  const wanted = retiredStageAlias(settings.defaultStageId) ?? settings.defaultStageId;
  const defaultStageId = live.some((s) => s.id === wanted)
    ? wanted
    : (live.find((s) => s.kind === 'active') ?? live[0] ?? stages[0])?.id;
  return { ...settings, stages, defaultStageId: defaultStageId ?? settings.defaultStageId };
}

/** When the job last moved into its current column, else when it last changed. */
function lastMoveInto(job: Job): string {
  const moves = job.activity.filter(
    (a) =>
      (a.type === 'stage_changed' || (a.type === 'email_update' && !a.undone)) &&
      a.toStageId === job.stageId,
  );
  return moves.at(-1)?.at ?? job.updatedAt;
}

/**
 * Moves a job off a retired column. A withdrawn job gets a "Withdrawn →
 * Rejected" entry dated when it was withdrawn, so its history keeps the truth
 * and History still dates it by when it finished. Doesn't touch `updatedAt`;
 * callers that need the change to sync stamp it themselves.
 */
export function normalizeJob(job: Job): Job {
  const alias = retiredStageAlias(job.stageId);
  if (!alias) return job;
  if (job.stageId !== 'withdrawn') return { ...job, stageId: alias };
  const at = lastMoveInto(job);
  const entry: Activity = {
    id: `${job.id}:withdrawn:${at}`,
    at,
    type: 'stage_changed',
    fromStageId: job.stageId,
    toStageId: alias,
  };
  const activity = job.activity.some((a) => a.id === entry.id)
    ? job.activity
    : [...job.activity, entry];
  return { ...job, stageId: alias, activity };
}
