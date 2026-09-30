import { ACTIVE_JOB_LIMITS, FREE_ACTIVE_JOB_LIMIT, type Plan } from '@/domain/plan';
import { JobLimitError, JobService, type PlanProvider } from '@/services/job-service';
import { JobRepository } from '@/storage/job-repository';
import { MemoryKeyValueStore } from '@/storage/key-value-store';
import { migrate } from '@/storage/migrations';
import { SettingsRepository } from '@/storage/settings-repository';
import { makeJob, makeResult, testContext } from '../helpers/factories';

async function setup(plan?: Plan, existing: { active: number; lost?: number } = { active: 0 }) {
  const store = new MemoryKeyValueStore();
  await migrate(store);
  const jobs = new JobRepository(store);
  const provider: PlanProvider | undefined = plan
    ? { currentPlan: () => Promise.resolve(plan) }
    : undefined;
  const service = new JobService(jobs, new SettingsRepository(store), testContext(), provider);
  await jobs.saveMany([
    ...Array.from({ length: existing.active }, (_, i) => makeJob({ id: `a${i}` })),
    ...Array.from({ length: existing.lost ?? 0 }, (_, i) =>
      makeJob({ id: `l${i}`, stageId: 'rejected' }),
    ),
  ]);
  return { service, jobs };
}

const posting = { title: 'Manual role', company: 'Acme', employmentTypes: [] };

describe('free-plan limit in JobService', () => {
  it('is off when accounts are not configured (no plan provider)', async () => {
    const { service } = await setup(undefined, { active: FREE_ACTIVE_JOB_LIMIT + 5 });
    expect(await service.limitCheck()).toBeUndefined();
    await expect(service.createManual({ posting })).resolves.toBeDefined();
  });

  it('blocks new captures and manual jobs at the limit on Free', async () => {
    const { service, jobs } = await setup('free', { active: FREE_ACTIVE_JOB_LIMIT });
    await expect(service.createFromExtraction(makeResult())).rejects.toBeInstanceOf(JobLimitError);
    const error = await service.createManual({ posting }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JobLimitError);
    expect((error as JobLimitError).check).toEqual({
      allowed: false,
      active: FREE_ACTIVE_JOB_LIMIT,
      limit: FREE_ACTIVE_JOB_LIMIT,
    });
    expect(await jobs.list()).toHaveLength(FREE_ACTIVE_JOB_LIMIT);
  });

  it('does not count rejected or withdrawn jobs', async () => {
    const { service } = await setup('free', { active: FREE_ACTIVE_JOB_LIMIT - 1, lost: 40 });
    await expect(service.createManual({ posting })).resolves.toBeDefined();
    await expect(service.createManual({ posting })).rejects.toBeInstanceOf(JobLimitError);
  });

  it('gives Pro 45 and Advanced 95, and never blocks edits or moves on Free', async () => {
    const pro = await setup('pro', { active: ACTIVE_JOB_LIMITS.pro - 1 });
    await expect(pro.service.createManual({ posting })).resolves.toBeDefined();
    await expect(pro.service.createManual({ posting })).rejects.toBeInstanceOf(JobLimitError);
    const advanced = await setup('advanced', { active: ACTIVE_JOB_LIMITS.pro + 10 });
    await expect(advanced.service.createManual({ posting })).resolves.toBeDefined();

    const free = await setup('free', { active: FREE_ACTIVE_JOB_LIMIT + 3 });
    await expect(free.service.update('a0', { notes: 'still editable' })).resolves.toMatchObject({
      notes: 'still editable',
    });
    await expect(free.service.move('a1', 'applied', 0)).resolves.toHaveLength(1);
  });

  it('reports duplicates before the limit', async () => {
    // At the limit and already tracked: the user should hear "already tracked".
    const existing = makeJob({ id: 'dup', source: { ...makeJob().source, url: makeResult().url } });
    const withDup = await setup('free', { active: FREE_ACTIVE_JOB_LIMIT - 1 });
    await withDup.jobs.save(existing);
    await expect(withDup.service.createFromExtraction(makeResult())).rejects.toMatchObject({
      name: 'DuplicateJobError',
    });
  });
});

describe('archiving in JobService', () => {
  it('frees a place in the limit, and restoring checks it again', async () => {
    const { service } = await setup('free', { active: FREE_ACTIVE_JOB_LIMIT });
    await expect(service.createManual({ posting })).rejects.toBeInstanceOf(JobLimitError);

    const archived = await service.archive('a0');
    expect(archived.archivedAt).toBeDefined();
    expect(archived.activity.at(-1)?.type).toBe('archived');
    expect(await service.archive('a0')).toEqual(archived); // idempotent
    await expect(service.createManual({ posting })).resolves.toBeDefined();

    // The board is full again, so the archived job can't come back yet.
    await expect(service.unarchive('a0')).rejects.toBeInstanceOf(JobLimitError);
    await service.archive('a1');
    const restored = await service.unarchive('a0');
    expect(restored.archivedAt).toBeUndefined();
    expect(restored.activity.at(-1)?.type).toBe('unarchived');
    expect(await service.unarchive('a0')).toEqual(restored); // not archived: no-op
  });

  it('restores rejected jobs even when the board is full', async () => {
    const { service } = await setup('free', { active: FREE_ACTIVE_JOB_LIMIT, lost: 1 });
    await service.archive('l0');
    await expect(service.unarchive('l0')).resolves.toMatchObject({ stageId: 'rejected' });
  });
});
