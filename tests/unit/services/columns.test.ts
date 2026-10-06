import type { Plan } from '@/domain/plan';
import { ColumnError, ColumnService, ColumnsLockedError } from '@/services/column-service';
import { JobRepository } from '@/storage/job-repository';
import { MemoryKeyValueStore } from '@/storage/key-value-store';
import { migrate } from '@/storage/migrations';
import { SettingsRepository } from '@/storage/settings-repository';
import { makeJob, testContext } from '../helpers/factories';

async function setup(plan?: Plan) {
  const store = new MemoryKeyValueStore();
  await migrate(store);
  const settings = new SettingsRepository(store);
  const jobs = new JobRepository(store);
  const plans = plan ? { currentPlan: () => Promise.resolve(plan) } : undefined;
  return { service: new ColumnService(settings, jobs, testContext(), plans), settings, jobs };
}

describe('ColumnService', () => {
  it('is locked on Free and leaves the columns alone', async () => {
    const { service, settings } = await setup('free');
    const before = await settings.get();
    expect(await service.canEdit()).toBe(false);
    await expect(service.rename('saved', 'Wishlist')).rejects.toBeInstanceOf(ColumnsLockedError);
    expect(await settings.get()).toEqual(before);
  });

  it('saves edits on Pro, and builds without accounts are unlimited', async () => {
    for (const plan of ['pro', undefined] as const) {
      const { service, settings } = await setup(plan);
      await service.rename('saved', 'Wishlist');
      await service.add({ name: 'Take-home', color: 'violet', kind: 'active', marksApplied: true });
      await service.move('applied', -1);
      await service.recolor('applied', 'amber');
      await service.setDefault('applied');
      const s = await settings.get();
      expect(s.stages[0]).toMatchObject({ id: 'applied', color: 'amber' });
      expect(s.stages[1]?.name).toBe('Wishlist');
      expect(s.stages.some((x) => x.name === 'Take-home' && x.id.startsWith('col-'))).toBe(true);
      expect(s.defaultStageId).toBe('applied');
    }
  });

  it('explains why an archive is refused, and archives and restores otherwise', async () => {
    const { service, jobs, settings } = await setup('pro');
    await jobs.save(makeJob({ id: 'a', stageId: 'applied' }));
    await expect(service.archive('applied')).rejects.toThrow(ColumnError);
    await expect(service.archive('applied')).rejects.toThrow(/Move or archive the 1 job/);
    await service.archive('interviewing');
    expect((await settings.get()).stages.find((s) => s.id === 'interviewing')?.archived).toBe(true);
    await service.restore('interviewing');
    expect(
      (await settings.get()).stages.find((s) => s.id === 'interviewing')?.archived,
    ).toBeUndefined();
  });
});
