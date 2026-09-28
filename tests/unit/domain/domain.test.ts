import { createJob, moveJob, updateJob } from '@/domain/job-factory';
import { JobSchema } from '@/domain/job';
import { evenRanks, needsRebalance, rankBetween, RANK_STEP } from '@/domain/rank';
import { SettingsSchema, DEFAULT_SETTINGS } from '@/domain/settings';
import { DEFAULT_STAGES } from '@/domain/stage';
import { testContext } from '../helpers/factories';

const stage = (id: string) => DEFAULT_STAGES.find((s) => s.id === id)!;

const source = {
  url: 'https://example.com/jobs/1',
  originalUrl: 'https://example.com/jobs/1?utm_source=x',
  siteId: 'generic',
  siteName: 'example.com',
  capturedAt: '2026-09-28T00:00:00.000Z',
};

describe('rank', () => {
  it('places between, before and after neighbours', () => {
    expect(rankBetween(undefined, undefined)).toBe(RANK_STEP);
    expect(rankBetween(1024, 2048)).toBe(1536);
    expect(rankBetween(undefined, 1024)).toBe(0);
    expect(rankBetween(1024, undefined)).toBe(2048);
  });

  it('detects exhausted gaps', () => {
    expect(needsRebalance(1, 1 + 1e-9)).toBe(true);
    expect(needsRebalance(1, 2)).toBe(false);
    expect(needsRebalance(undefined, 2)).toBe(false);
    expect(evenRanks(3)).toEqual([1024, 2048, 3072]);
  });
});

describe('job lifecycle', () => {
  it('creates a valid job with a created activity', () => {
    const ctx = testContext();
    const job = createJob(
      {
        posting: { title: 'Dev', company: 'Acme', employmentTypes: [] },
        source,
        stage: stage('saved'),
        rank: 1,
      },
      ctx,
    );
    expect(JobSchema.parse(job)).toEqual(job);
    expect(job.activity).toEqual([
      { id: 'id-2', at: '2026-09-28T00:00:00.000Z', type: 'created', toStageId: 'saved' },
    ]);
    expect(job.appliedAt).toBeUndefined();
  });

  it('stamps appliedAt when created directly in an applied-type stage', () => {
    const job = createJob(
      {
        posting: { title: 'Dev', company: '', employmentTypes: [] },
        source,
        stage: stage('applied'),
        rank: 1,
      },
      testContext(),
    );
    expect(job.appliedAt).toBe('2026-09-28T00:00:00.000Z');
  });

  it('records stage changes and stamps appliedAt only once', () => {
    const ctx = testContext();
    const job = createJob(
      {
        posting: { title: 'Dev', company: '', employmentTypes: [] },
        source,
        stage: stage('saved'),
        rank: 1,
      },
      ctx,
    );
    ctx.advance(60_000);
    const applied = moveJob(job, stage('applied'), 5, ctx);
    expect(applied.stageId).toBe('applied');
    expect(applied.appliedAt).toBe('2026-09-28T00:01:00.000Z');
    expect(applied.activity.at(-1)).toMatchObject({
      type: 'stage_changed',
      fromStageId: 'saved',
      toStageId: 'applied',
    });
    ctx.advance(60_000);
    const interviewing = moveJob(applied, stage('interviewing'), 5, ctx);
    expect(interviewing.appliedAt).toBe(applied.appliedAt);
  });

  it('reordering within a stage changes only the rank', () => {
    const ctx = testContext();
    const job = createJob(
      {
        posting: { title: 'Dev', company: '', employmentTypes: [] },
        source,
        stage: stage('saved'),
        rank: 1,
      },
      ctx,
    );
    const moved = moveJob(job, stage('saved'), 7, ctx);
    expect(moved.rank).toBe(7);
    expect(moved.activity).toHaveLength(1);
    expect(moveJob(moved, stage('saved'), 7, ctx)).toBe(moved);
  });

  it('coalesces rapid edits into one activity entry and clears fields set to undefined', () => {
    const ctx = testContext();
    let job = createJob(
      {
        posting: { title: 'Dev', company: '', employmentTypes: [], location: 'Sydney' },
        source,
        stage: stage('saved'),
        rank: 1,
      },
      ctx,
    );
    ctx.advance(1000);
    job = updateJob(job, { notes: 'a' }, ctx);
    ctx.advance(1000);
    job = updateJob(job, { notes: 'ab', priority: 2 }, ctx);
    expect(job.activity.filter((a) => a.type === 'edited')).toHaveLength(1);
    expect(job.activity.at(-1)?.fields).toEqual(['notes', 'priority']);

    ctx.advance(10 * 60_000);
    job = updateJob(job, { location: undefined }, ctx);
    expect('location' in job).toBe(false);
    expect(job.activity.filter((a) => a.type === 'edited')).toHaveLength(2);
  });

  it('ignores no-op edits', () => {
    const ctx = testContext();
    const job = createJob(
      {
        posting: { title: 'Dev', company: 'A', employmentTypes: [] },
        source,
        stage: stage('saved'),
        rank: 1,
      },
      ctx,
    );
    expect(updateJob(job, { title: 'Dev' }, ctx)).toBe(job);
  });
});

describe('settings', () => {
  it('defaults are valid', () => {
    expect(SettingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it('rejects a default stage that does not exist', () => {
    expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, defaultStageId: 'nope' }).success).toBe(
      false,
    );
  });
});
