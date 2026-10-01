import {
  addStage,
  archiveStage,
  moveStage,
  recolorStage,
  renameStage,
  restoreStage,
  setDefaultStage,
  type ColumnResult,
  type NewStage,
} from '@/domain/columns';
import type { DomainContext } from '@/domain/job-factory';
import type { Settings } from '@/domain/settings';
import type { StageColor, StageId } from '@/domain/stage';
import type { JobRepository } from '@/storage/job-repository';
import type { SettingsRepository } from '@/storage/settings-repository';
import type { PlanProvider } from './job-service';

/** A column edit that can't be made; the message is shown as is. */
export class ColumnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ColumnError';
  }
}

/** Customising columns is Pro (ADR-0013). */
export class ColumnsLockedError extends ColumnError {
  constructor() {
    super('Custom columns are part of Pro.');
    this.name = 'ColumnsLockedError';
  }
}

/**
 * Custom columns (Pro). Free keeps whatever columns it has, untouched;
 * builds without accounts aren't limited, as with job limits.
 */
export class ColumnService {
  constructor(
    private readonly settings: SettingsRepository,
    private readonly jobs: JobRepository,
    private readonly ctx: DomainContext,
    private readonly plans?: PlanProvider,
  ) {}

  async canEdit(): Promise<boolean> {
    return !this.plans || (await this.plans.currentPlan()) !== 'free';
  }

  private async apply(edit: (settings: Settings) => ColumnResult | Promise<ColumnResult>) {
    if (!(await this.canEdit())) throw new ColumnsLockedError();
    const result = await edit(await this.settings.get());
    if (!result.ok) throw new ColumnError(result.reason);
    return this.settings.replace(result.settings);
  }

  rename(id: StageId, name: string) {
    return this.apply((s) => renameStage(s, id, name));
  }

  recolor(id: StageId, color: StageColor) {
    return this.apply((s) => recolorStage(s, id, color));
  }

  move(id: StageId, direction: -1 | 1) {
    return this.apply((s) => moveStage(s, id, direction));
  }

  add(input: NewStage) {
    return this.apply((s) => addStage(s, input, `col-${this.ctx.newId()}`));
  }

  archive(id: StageId) {
    return this.apply(async (s) => archiveStage(s, id, await this.jobs.list()));
  }

  restore(id: StageId) {
    return this.apply((s) => restoreStage(s, id));
  }

  setDefault(id: StageId) {
    return this.apply((s) => setDefaultStage(s, id));
  }
}
