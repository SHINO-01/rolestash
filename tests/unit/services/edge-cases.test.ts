import { extractJob, toPosting } from '@/extraction';
import type { SiteAdapter } from '@/extraction';
import { createServices, systemContext } from '@/services/container';
import type { ExtractorRunner } from '@/services/ports';
import { MemoryKeyValueStore } from '@/storage/key-value-store';
import { htmlDoc } from '../helpers/dom';
import { makeJob, makeResult } from '../helpers/factories';

const runner: ExtractorRunner = {
  run: () => Promise.resolve([]),
  snapshot: () => Promise.resolve({ url: '', title: '', html: '' }),
};

describe('service edge cases', () => {
  it('uses the real clock and UUIDs by default', async () => {
    const services = createServices(new MemoryKeyValueStore(), runner);
    await services.ready;
    const job = await services.jobService.createManual({
      posting: { title: 'A', company: '', employmentTypes: [] },
    });
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      Math.abs(new Date(job.createdAt).getTime() - systemContext.now().getTime()),
    ).toBeLessThan(5000);
  });

  it('falls back to the default stage when a capture names an unknown one', async () => {
    const { jobService } = createServices(new MemoryKeyValueStore(), runner);
    const job = await jobService.createFromExtraction(makeResult(), { stageId: 'nope' });
    expect(job.stageId).toBe('saved');
  });

  it('no-op updates return the same job; missing jobs throw', async () => {
    const { jobService, jobs } = createServices(new MemoryKeyValueStore(), runner);
    const saved = await jobs.save(makeJob({ id: 'a' }));
    expect(await jobService.update('a', { title: saved.title })).toEqual(saved);
    await expect(jobService.update('missing', { title: 'x' })).rejects.toThrow(/not found/);
    expect(await jobService.list()).toHaveLength(1);
  });

  it('a move to the same place writes nothing new', async () => {
    const { jobService, jobs } = createServices(new MemoryKeyValueStore(), runner);
    await jobs.save(makeJob({ id: 'a', rank: 1024 }));
    const [same] = await jobService.move('a', 'saved', 0);
    expect(same?.updatedAt).toBe('2026-09-01T00:00:00.000Z');
  });
});

describe('pipeline fault tolerance', () => {
  const doc = htmlDoc(
    '<html><head><title>Dev at Acme</title></head><body><h1>Dev</h1></body></html>',
  );
  const faulty: SiteAdapter = {
    id: 'faulty',
    name: 'Faulty',
    kind: 'job-board',
    regions: ['global'],
    homepage: 'https://faulty.example',
    hosts: ['faulty.example'],
    canonicalUrl: () => {
      throw new Error('boom');
    },
    extract: () => {
      throw new Error('boom');
    },
  };

  it('survives adapters that throw and falls back to generic canonicalisation', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = extractJob(doc, 'https://www.faulty.example/job?utm_source=x', {
      adapters: [faulty],
    });
    expect(result.url).toBe('https://faulty.example/job');
    expect(result.fields.title).toBe('Dev');
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('toPosting clamps long salary text and drops invalid apply URLs', () => {
    const posting = toPosting(
      makeResult({
        fields: { title: 'T', salary: { text: 'x'.repeat(500) }, applyUrl: 'not a url' },
      }),
    );
    expect(posting.salary?.text).toHaveLength(200);
    expect(posting.applyUrl).toBeUndefined();
    // A hostile page's structured data can't plant a script link.
    for (const applyUrl of ['javascript:alert(1)', 'data:text/html,x'])
      expect(toPosting(makeResult({ fields: { title: 'T', applyUrl } })).applyUrl).toBeUndefined();
  });
});
