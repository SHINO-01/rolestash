import { createJob, moveJob, updateJob, type DomainContext } from '@/domain/job-factory';
import { MANUAL_URL_HOST, type Job, type JobId, type JobPatch, type Posting } from '@/domain/job';
import { evenRanks, needsRebalance, RANK_STEP, rankBetween } from '@/domain/rank';
import { findStage, type Stage, type StageId } from '@/domain/stage';
import { canonicalizeUrl, toExtractionMeta, toPosting, type ExtractionResult } from '@/extraction';
import type { JobRepository } from '@/storage/job-repository';
import type { SettingsRepository } from '@/storage/settings-repository';

/**
 * Application service: every use case that changes jobs goes through here so
 * the popup, board and background worker share one implementation.
 */

export interface CaptureOptions {
  /** User edits made in the popup before saving. */
  overrides?: Partial<Posting>;
  stageId?: StageId;
  priority?: Job['priority'];
  notes?: string;
  tags?: string[];
}

export interface ManualJobInput {
  posting: Posting;
  url?: string;
  stageId?: StageId;
}

export class DuplicateJobError extends Error {
  constructor(readonly existing: Job) {
    super(`Already tracked: ${existing.title}`);
    this.name = 'DuplicateJobError';
  }
}

export class JobService {
  constructor(
    private readonly jobs: JobRepository,
    private readonly settings: SettingsRepository,
    private readonly ctx: DomainContext,
  ) {}

  list(): Promise<Job[]> {
    return this.jobs.list();
  }

  /** Same canonical URL, or same site + external id. */
  async findDuplicate(url: string, siteId?: string, externalId?: string): Promise<Job | undefined> {
    const canonical = canonicalizeUrl(url);
    const all = await this.jobs.list();
    return all.find(
      (job) =>
        canonicalizeUrl(job.source.url) === canonical ||
        (externalId !== undefined &&
          siteId !== undefined &&
          siteId !== 'generic' &&
          job.source.siteId === siteId &&
          job.externalId === externalId),
    );
  }

  async createFromExtraction(result: ExtractionResult, options: CaptureOptions = {}): Promise<Job> {
    const duplicate = await this.findDuplicate(
      result.url,
      result.site.id,
      result.fields.externalId,
    );
    if (duplicate) throw new DuplicateJobError(duplicate);

    const stage = await this.resolveStage(options.stageId);
    const job = createJob(
      {
        posting: toPosting(result, options.overrides),
        source: {
          url: result.url,
          originalUrl: result.originalUrl,
          siteId: result.site.id,
          siteName: result.site.name,
          capturedAt: this.ctx.now().toISOString(),
        },
        stage,
        rank: await this.topRank(stage.id),
        extraction: toExtractionMeta(result),
        ...(options.priority !== undefined ? { priority: options.priority } : {}),
        ...(options.notes ? { notes: options.notes } : {}),
        ...(options.tags ? { tags: options.tags } : {}),
      },
      this.ctx,
    );
    return this.jobs.save(job);
  }

  async createManual(input: ManualJobInput): Promise<Job> {
    const stage = await this.resolveStage(input.stageId);
    const url = input.url ? canonicalizeUrl(input.url) : undefined;
    if (url) {
      const duplicate = await this.findDuplicate(url);
      if (duplicate) throw new DuplicateJobError(duplicate);
    }
    const job = createJob(
      {
        posting: input.posting,
        source: {
          // Manual jobs without a link get a stable, unique placeholder URL.
          url: url ?? `https://${MANUAL_URL_HOST}/manual/${this.ctx.newId()}`,
          originalUrl: input.url ?? `https://${MANUAL_URL_HOST}/manual`,
          siteId: 'manual',
          siteName: 'Added manually',
          capturedAt: this.ctx.now().toISOString(),
        },
        stage,
        rank: await this.topRank(stage.id),
      },
      this.ctx,
    );
    return this.jobs.save(job);
  }

  /**
   * Moves a job to `index` within `toStageId` (index counted among the
   * stage's other jobs, in rank order). Returns every job that was written —
   * usually just the moved one, the whole column after a rebalance.
   */
  async move(jobId: JobId, toStageId: StageId, index: number): Promise<Job[]> {
    const [job, stage, all] = await Promise.all([
      this.require(jobId),
      this.resolveStage(toStageId, true),
      this.jobs.list(),
    ]);
    const siblings = all
      .filter((j) => j.stageId === stage.id && j.id !== jobId)
      .sort((a, b) => a.rank - b.rank);
    const clamped = Math.max(0, Math.min(index, siblings.length));
    const before = siblings[clamped - 1]?.rank;
    const after = siblings[clamped]?.rank;

    if (needsRebalance(before, after)) {
      const ordered = [...siblings.slice(0, clamped), job, ...siblings.slice(clamped)];
      const ranks = evenRanks(ordered.length);
      const moved = ordered.map((j, i) => {
        const rank = ranks[i] ?? (i + 1) * RANK_STEP;
        return j.id === jobId ? moveJob(j, stage, rank, this.ctx) : { ...j, rank };
      });
      return this.jobs.saveMany(moved);
    }
    const next = moveJob(job, stage, rankBetween(before, after), this.ctx);
    return next === job ? [job] : [await this.jobs.save(next)];
  }

  async update(jobId: JobId, patch: JobPatch): Promise<Job> {
    const job = await this.require(jobId);
    const next = updateJob(job, patch, this.ctx);
    return next === job ? job : this.jobs.save(next);
  }

  async remove(jobId: JobId): Promise<Job | undefined> {
    const job = await this.jobs.get(jobId);
    await this.jobs.delete(jobId);
    return job;
  }

  /** Re-inserts a deleted job exactly as it was (undo). */
  async restore(job: Job): Promise<Job> {
    return this.jobs.save(job);
  }

  private async require(jobId: JobId): Promise<Job> {
    const job = await this.jobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    return job;
  }

  private async resolveStage(stageId: StageId | undefined, strict = false): Promise<Stage> {
    const settings = await this.settings.get();
    const stage = findStage(settings.stages, stageId ?? settings.defaultStageId);
    if (stage) return stage;
    if (strict) throw new Error(`Unknown stage ${String(stageId)}`);
    const fallback = findStage(settings.stages, settings.defaultStageId) ?? settings.stages[0];
    if (!fallback) throw new Error('No stages configured');
    return fallback;
  }

  /** New cards go to the top of their column. */
  private async topRank(stageId: StageId): Promise<number> {
    const ranks = (await this.jobs.list()).filter((j) => j.stageId === stageId).map((j) => j.rank);
    return rankBetween(undefined, ranks.length ? Math.min(...ranks) : undefined);
  }
}
