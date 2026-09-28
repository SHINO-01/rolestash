import type { Job } from '@/domain/job';
import type { Stage } from '@/domain/stage';

const WEEK_MS = 7 * 86_400_000;

/** Pure so it can be unit-tested and reused by a future analytics view. */
export function computeStats(jobs: readonly Job[], stages: readonly Stage[], now = Date.now()) {
  const kind = new Map(stages.map((s) => [s.id, s.kind]));
  return {
    active: jobs.filter((j) => kind.get(j.stageId) === 'active').length,
    appliedThisWeek: jobs.filter(
      (j) => j.appliedAt && now - new Date(j.appliedAt).getTime() < WEEK_MS,
    ).length,
    interviewing: jobs.filter((j) => j.stageId === 'interviewing').length,
    offers: jobs.filter((j) => kind.get(j.stageId) === 'won').length,
  };
}
