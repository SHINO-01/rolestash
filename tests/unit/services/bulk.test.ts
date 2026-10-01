import { JobService } from '@/services/job-service';
import { JobRepository } from '@/storage/job-repository';
import { MemoryKeyValueStore } from '@/storage/key-value-store';
import { migrate } from '@/storage/migrations';
import { SettingsRepository } from '@/storage/settings-repository';
import { makeJob, testContext } from '../helpers/factories';

async function setup() {
  const store = new MemoryKeyValueStore();
  await migrate(store);
  const jobs = new JobRepository(store);
  const service = new JobService(jobs, new SettingsRepository(store), testContext());
  await jobs.saveMany([
    makeJob({ id: 'a', stageId: 'saved', rank: 1 }),
    makeJob({ id: 'b', stageId: 'saved', rank: 2 }),
    makeJob({ id: 'c', stageId: 'saved', rank: 3 }),
    makeJob({ id: 'x', stageId: 'applied', rank: 1 }),
  ]);
  return { jobs, service };
}

const column = async (jobs: JobRepository, stageId: string) =>
  (await jobs.list())
    .filter((j) => j.stageId === stageId && !j.archivedAt)
    .sort((p, q) => p.rank - q.rank)
    .map((j) => j.id);

describe('bulk actions', () => {
  it('moves several jobs to the top of a column, keeping their order', async () => {
    const { jobs, service } = await setup();
    const written = await service.moveMany(['a', 'c'], 'applied');
    expect(written.map((j) => j.id).sort()).toEqual(['a', 'c']);
    expect(await column(jobs, 'applied')).toEqual(['a', 'c', 'x']);
    expect(await column(jobs, 'saved')).toEqual(['b']);
    expect((await jobs.get('a'))?.appliedAt).toBeDefined();
  });

  it('archives several jobs', async () => {
    const { jobs, service } = await setup();
    await service.archiveMany(['a', 'b']);
    expect(await column(jobs, 'saved')).toEqual(['c']);
    expect((await jobs.get('a'))?.archivedAt).toBeDefined();
  });

  it('tags several jobs once each, and ignores an empty tag', async () => {
    const { jobs, service } = await setup();
    await jobs.save({ ...(await jobs.get('b'))!, tags: ['remote'] });
    await jobs.save({
      ...(await jobs.get('c'))!,
      tags: Array.from({ length: 30 }, (_, i) => `t${String(i)}`),
    });
    await service.tagMany(['a', 'b', 'c'], ' #remote ');
    expect((await jobs.get('a'))?.tags).toEqual(['remote']);
    expect((await jobs.get('b'))?.tags).toEqual(['remote']);
    expect((await jobs.get('c'))?.tags).toHaveLength(30);
    expect(await service.tagMany(['a'], '  ')).toEqual([]);
  });

  it('deletes several jobs and puts them back exactly', async () => {
    const { jobs, service } = await setup();
    const before = await jobs.get('a');
    const removed = await service.removeMany(['a', 'b', 'missing']);
    expect(removed.map((j) => j.id)).toEqual(['a', 'b']);
    expect(await column(jobs, 'saved')).toEqual(['c']);
    await service.restoreMany(removed);
    expect(await jobs.get('a')).toEqual(before);
    expect(await column(jobs, 'saved')).toEqual(['a', 'b', 'c']);
  });
});
