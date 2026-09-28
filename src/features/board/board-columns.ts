import type { Job } from '@/domain/job';
import type { Stage, StageId } from '@/domain/stage';

/** Column id → ordered job ids. The unit of state for drag-and-drop. */
export type Columns = Record<StageId, string[]>;

export function groupIntoColumns(
  stages: readonly Stage[],
  jobs: readonly Job[],
  defaultStageId: StageId,
): Columns {
  const columns: Columns = Object.fromEntries(stages.map((s) => [s.id, [] as string[]]));
  const sorted = [...jobs].sort(
    (a, b) => a.rank - b.rank || a.createdAt.localeCompare(b.createdAt),
  );
  for (const job of sorted) {
    // Jobs in a stage that no longer exists stay visible in the default column.
    (columns[job.stageId] ?? columns[defaultStageId] ?? Object.values(columns)[0])?.push(job.id);
  }
  return columns;
}

export function findColumn(columns: Columns, id: string): StageId | undefined {
  if (id in columns) return id;
  return Object.keys(columns).find((key) => columns[key]?.includes(id));
}

/**
 * Translates a drop position in a (possibly filtered) column into an index
 * among *all* jobs of that stage, using the visible neighbours as anchors.
 */
export function resolveDropIndex(
  allInStage: readonly Job[],
  movingId: string,
  prevVisibleId: string | undefined,
  nextVisibleId: string | undefined,
): number {
  const siblings = allInStage.filter((j) => j.id !== movingId).sort((a, b) => a.rank - b.rank);
  if (nextVisibleId) {
    const i = siblings.findIndex((j) => j.id === nextVisibleId);
    if (i >= 0) return i;
  }
  if (prevVisibleId) {
    const i = siblings.findIndex((j) => j.id === prevVisibleId);
    if (i >= 0) return i + 1;
  }
  return nextVisibleId ? 0 : siblings.length;
}
