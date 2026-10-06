import type { Job } from './job';
import type { Settings } from './settings';
import { STAGE_COLORS, type Stage, type StageColor, type StageId, type StageKind } from './stage';

/**
 * Custom columns (Pro; ADR-0013): pure edits to `settings.stages`. Each
 * returns the next settings, or a reason it can't be done. Columns are
 * archived rather than deleted, so jobs and History keep their names.
 */

export const MAX_STAGES = 20;
export const MAX_STAGE_NAME = 40;

export type ColumnResult = { ok: true; settings: Settings } | { ok: false; reason: string };

const ok = (settings: Settings): ColumnResult => ({ ok: true, settings });
const fail = (reason: string): ColumnResult => ({ ok: false, reason });

function withStage(settings: Settings, id: StageId, change: (s: Stage) => Stage): Settings {
  return { ...settings, stages: settings.stages.map((s) => (s.id === id ? change(s) : s)) };
}

function checkName(settings: Settings, name: string, except?: StageId): string | undefined {
  const clean = name.trim();
  if (!clean) return 'Give the column a name.';
  if (clean.length > MAX_STAGE_NAME)
    return `Keep column names to ${String(MAX_STAGE_NAME)} characters.`;
  const taken = settings.stages.some(
    (s) => s.id !== except && s.name.trim().toLowerCase() === clean.toLowerCase(),
  );
  return taken ? `There's already a column called “${clean}”.` : undefined;
}

export function renameStage(settings: Settings, id: StageId, name: string): ColumnResult {
  const problem = checkName(settings, name, id);
  return problem
    ? fail(problem)
    : ok(withStage(settings, id, (s) => ({ ...s, name: name.trim() })));
}

export function recolorStage(settings: Settings, id: StageId, color: StageColor): ColumnResult {
  return STAGE_COLORS.includes(color)
    ? ok(withStage(settings, id, (s) => ({ ...s, color })))
    : fail('Unknown colour.');
}

/** Moves a column one place left (-1) or right (+1) among the visible columns. */
export function moveStage(settings: Settings, id: StageId, direction: -1 | 1): ColumnResult {
  const visible = settings.stages.filter((s) => !s.archived);
  const from = visible.findIndex((s) => s.id === id);
  const to = from + direction;
  const target = visible[to];
  if (from < 0 || !target) return ok(settings);
  const stages = [...settings.stages];
  const a = stages.findIndex((s) => s.id === id);
  const b = stages.findIndex((s) => s.id === target.id);
  const moving = stages[a];
  const other = stages[b];
  if (!moving || !other) return ok(settings);
  stages[a] = other;
  stages[b] = moving;
  return ok({ ...settings, stages });
}

export interface NewStage {
  name: string;
  color: StageColor;
  kind: StageKind;
  marksApplied: boolean;
}

/**
 * Adds a column. In-progress columns go after the last in-progress one, so
 * finished columns stay at the end; finished ones go last.
 */
export function addStage(settings: Settings, input: NewStage, id: StageId): ColumnResult {
  if (settings.stages.length >= MAX_STAGES)
    return fail(`A board can have up to ${String(MAX_STAGES)} columns, archived ones included.`);
  const problem = checkName(settings, input.name);
  if (problem) return fail(problem);
  const stage: Stage = {
    id,
    name: input.name.trim(),
    color: input.color,
    kind: input.kind,
    marksApplied: input.kind === 'active' ? input.marksApplied : true,
  };
  const stages = [...settings.stages];
  const lastActive = stages.reduce((at, s, i) => (s.kind === 'active' ? i : at), -1);
  stages.splice(input.kind === 'active' ? lastActive + 1 : stages.length, 0, stage);
  return ok({ ...settings, stages });
}

/** Hides a column. Blocked while jobs are on it, for the default column, or the last one. */
export function archiveStage(settings: Settings, id: StageId, jobs: readonly Job[]): ColumnResult {
  const stage = settings.stages.find((s) => s.id === id);
  if (!stage || stage.archived) return ok(settings);
  if (id === settings.defaultStageId)
    return fail(`New jobs go to “${stage.name}”. Choose another column for new jobs first.`);
  if (settings.stages.filter((s) => !s.archived).length <= 1)
    return fail('The board needs at least one column.');
  const onIt = jobs.filter((j) => j.stageId === id && !j.archivedAt).length;
  if (onIt > 0)
    return fail(
      `Move or archive the ${String(onIt)} job${onIt === 1 ? '' : 's'} in “${stage.name}” first.`,
    );
  return ok(withStage(settings, id, (s) => ({ ...s, archived: true })));
}

export function restoreStage(settings: Settings, id: StageId): ColumnResult {
  return ok(
    withStage(settings, id, (s) => {
      const { archived: _archived, ...rest } = s;
      return rest;
    }),
  );
}

/** Where new captures land: any column with a lane on the board (not a `lost` one). */
export function setDefaultStage(settings: Settings, id: StageId): ColumnResult {
  const stage = settings.stages.find((s) => s.id === id);
  if (!stage || stage.archived || stage.kind === 'lost')
    return fail('Pick a column that is on the board.');
  return ok({ ...settings, defaultStageId: id });
}
