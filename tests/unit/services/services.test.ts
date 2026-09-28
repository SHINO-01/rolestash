import type { ExtractionResult } from '@/extraction';
import { CaptureService, pickBest } from '@/services/capture-service';
import { createServices } from '@/services/container';
import { DuplicateJobError } from '@/services/job-service';
import type { ExtractorRunner } from '@/services/ports';
import { MemoryKeyValueStore } from '@/storage/key-value-store';
import { makeJob, makeResult, testContext } from '../helpers/factories';

class FakeRunner implements ExtractorRunner {
  constructor(public results: ExtractionResult[] | Error = []) {}
  run(): Promise<ExtractionResult[]> {
    return this.results instanceof Error
      ? Promise.reject(this.results)
      : Promise.resolve(this.results);
  }
  snapshot() {
    return Promise.resolve({ url: 'https://x', title: 'x', html: '<html></html>' });
  }
}

async function setup() {
  const services = createServices(new MemoryKeyValueStore(), new FakeRunner(), testContext());
  await services.ready;
  return services;
}

describe('JobService', () => {
  it('creates a job from an extraction at the top of the default column', async () => {
    const { jobService } = await setup();
    const first = await jobService.createFromExtraction(makeResult());
    const second = await jobService.createFromExtraction(
      makeResult({
        url: 'https://boards.greenhouse.io/acme/jobs/2',
        fields: { title: 'Two', externalId: '2' },
      }),
    );
    expect(first.stageId).toBe('saved');
    expect(second.rank).toBeLessThan(first.rank);
    expect(first.source).toMatchObject({
      siteId: 'greenhouse',
      url: 'https://boards.greenhouse.io/acme/jobs/1',
    });
    expect(first.extraction?.provenance.title).toBe('json-ld@0.95');
  });

  it('applies popup overrides and options', async () => {
    const { jobService } = await setup();
    const job = await jobService.createFromExtraction(makeResult(), {
      overrides: { title: 'Edited', company: 'Acme', employmentTypes: [] },
      stageId: 'applied',
      priority: 3,
      notes: 'Referral from Sam',
    });
    expect(job).toMatchObject({
      title: 'Edited',
      stageId: 'applied',
      priority: 3,
      notes: 'Referral from Sam',
    });
    expect(job.appliedAt).toBeDefined();
  });

  it('detects duplicates by canonical URL or by site + external id', async () => {
    const { jobService } = await setup();
    await jobService.createFromExtraction(makeResult());
    await expect(
      jobService.createFromExtraction(
        makeResult({ url: 'https://boards.greenhouse.io/acme/jobs/1/?utm_source=x' }),
      ),
    ).rejects.toBeInstanceOf(DuplicateJobError);
    await expect(
      jobService.createFromExtraction(makeResult({ url: 'https://other.url/1' })),
    ).rejects.toBeInstanceOf(DuplicateJobError);
    // Same external id on a *different* site is not a duplicate.
    await expect(
      jobService.createFromExtraction(
        makeResult({ url: 'https://other.url/1', site: { id: 'lever', name: 'Lever' } }),
      ),
    ).resolves.toBeDefined();
  });

  it('creates manual jobs with and without links', async () => {
    const { jobService } = await setup();
    const a = await jobService.createManual({
      posting: { title: 'A', company: '', employmentTypes: [] },
    });
    const b = await jobService.createManual({
      posting: { title: 'B', company: '', employmentTypes: [] },
    });
    expect(a.source.url).not.toBe(b.source.url);
    await jobService.createManual({
      posting: { title: 'C', company: '', employmentTypes: [] },
      url: 'https://x.com/j/1',
    });
    await expect(
      jobService.createManual({
        posting: { title: 'C', company: '', employmentTypes: [] },
        url: 'https://www.x.com/j/1#top',
      }),
    ).rejects.toBeInstanceOf(DuplicateJobError);
  });

  it('moves jobs between and within columns by index', async () => {
    const { jobService, jobs } = await setup();
    await jobs.saveMany([
      makeJob({ id: 'a', stageId: 'applied', rank: 1024 }),
      makeJob({ id: 'b', stageId: 'applied', rank: 2048 }),
      makeJob({ id: 'c', stageId: 'saved', rank: 1024 }),
    ]);
    await jobService.move('c', 'applied', 1);
    const applied = (await jobs.list())
      .filter((j) => j.stageId === 'applied')
      .sort((x, y) => x.rank - y.rank);
    expect(applied.map((j) => j.id)).toEqual(['a', 'c', 'b']);
    expect(applied[1]?.appliedAt).toBeDefined();

    await jobService.move('b', 'applied', 0);
    const reordered = (await jobs.list())
      .filter((j) => j.stageId === 'applied')
      .sort((x, y) => x.rank - y.rank);
    expect(reordered.map((j) => j.id)).toEqual(['b', 'a', 'c']);
  });

  it('rebalances a column when ranks run out of precision', async () => {
    const { jobService, jobs } = await setup();
    await jobs.saveMany([
      makeJob({ id: 'a', rank: 1 }),
      makeJob({ id: 'b', rank: 1 + 1e-9 }),
      makeJob({ id: 'x', stageId: 'applied', rank: 1 }),
    ]);
    const changed = await jobService.move('x', 'saved', 1);
    expect(changed).toHaveLength(3);
    const order = (await jobs.list())
      .filter((j) => j.stageId === 'saved')
      .sort((p, q) => p.rank - q.rank);
    expect(order.map((j) => [j.id, j.rank])).toEqual([
      ['a', 1024],
      ['x', 2048],
      ['b', 3072],
    ]);
  });

  it('rejects moves to unknown stages', async () => {
    const { jobService, jobs } = await setup();
    await jobs.save(makeJob({ id: 'a' }));
    await expect(jobService.move('a', 'nope', 0)).rejects.toThrow(/Unknown stage/);
  });

  it('deletes and restores (undo)', async () => {
    const { jobService, jobs } = await setup();
    await jobs.save(makeJob({ id: 'a' }));
    const removed = await jobService.remove('a');
    expect(await jobs.list()).toEqual([]);
    await jobService.restore(removed!);
    expect((await jobs.list()).map((j) => j.id)).toEqual(['a']);
  });
});

describe('CaptureService', () => {
  it('refuses browser-internal pages without injecting', async () => {
    const runner = new FakeRunner();
    const spy = vi.spyOn(runner, 'run');
    const outcome = await new CaptureService(runner).capture(1, 'chrome://settings');
    expect(outcome).toMatchObject({ ok: false, reason: 'restricted' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('maps permission errors to a friendly message', async () => {
    const outcome = await new CaptureService(
      new FakeRunner(new Error('Cannot access contents of the page')),
    ).capture(1, 'https://x');
    expect(outcome).toMatchObject({ ok: false, reason: 'restricted' });
  });

  it('reports empty results', async () => {
    expect(await new CaptureService(new FakeRunner([])).capture(1)).toMatchObject({
      ok: false,
      reason: 'no-result',
    });
  });

  it('prefers job pages, then confidence, then the top frame', () => {
    const top = makeResult({ confidence: 0.4, isJobPage: false });
    const frame = makeResult({ confidence: 0.8, isJobPage: true, fromFrame: true });
    expect(pickBest([top, frame])).toBe(frame);
    const topJob = makeResult({ confidence: 0.8, isJobPage: true, fromFrame: false });
    expect(pickBest([frame, topJob])).toBe(topJob);
    expect(pickBest([])).toBeUndefined();
  });
});
