import type { FillReport } from '@/autofill';
import type { Plan } from '@/domain/plan';
import { EMPTY_PROFILE, type Profile } from '@/domain/profile';
import { AutofillBlockedError, AutofillService } from '@/services/autofill-service';
import type { AutofillRunner } from '@/services/ports';
import { MemoryKeyValueStore } from '@/storage/key-value-store';
import { PROFILE_KEY } from '@/storage/keys';
import { ProfileRepository } from '@/storage/profile-repository';

function setup(plan?: Plan, reports: FillReport[] = []) {
  const store = new MemoryKeyValueStore();
  const profiles = new ProfileRepository(store);
  const calls: { tabId: number; profile: Profile }[] = [];
  const runner: AutofillRunner = {
    fill: (tabId, profile) => {
      calls.push({ tabId, profile });
      return Promise.resolve(reports);
    },
  };
  const service = new AutofillService(
    profiles,
    runner,
    plan ? { currentPlan: () => Promise.resolve(plan) } : undefined,
  );
  return { store, profiles, service, calls };
}

describe('ProfileRepository', () => {
  it('starts empty, saves with a timestamp, and survives bad data', async () => {
    const { store, profiles } = setup();
    expect(await profiles.get()).toEqual(EMPTY_PROFILE);
    const saved = await profiles.save(
      { ...EMPTY_PROFILE, firstName: 'Sam' },
      new Date('2026-10-02T00:00:00Z'),
    );
    expect(saved).toEqual({ answers: [], firstName: 'Sam', updatedAt: '2026-10-02T00:00:00.000Z' });
    expect(await profiles.get()).toEqual(saved);
    let changed = 0;
    const off = profiles.subscribe(() => changed++);
    await profiles.save(saved);
    off();
    expect(changed).toBe(1);
    await store.set({ [PROFILE_KEY]: { email: 42 } });
    expect(await profiles.get()).toEqual(EMPTY_PROFILE);
    await profiles.clear();
    expect(await store.get([PROFILE_KEY])).toEqual({});
  });

  it('rejects an invalid profile', async () => {
    const { profiles } = setup();
    await expect(profiles.save({ ...EMPTY_PROFILE, email: 'x'.repeat(300) })).rejects.toThrow();
  });
});

describe('AutofillService', () => {
  const report = (n: number): FillReport => ({
    filled: Array.from({ length: n }, (_, i) => ({ key: 'email', label: `f${String(i)}` })),
    skipped: [{ label: 'Gender', reason: 'sensitive', required: false }],
    files: ['Resume'],
    ats: 'greenhouse',
  });

  it('needs a profile on every plan', async () => {
    const free = setup('free');
    expect(await free.service.blocked()).toBe('no_profile');
    await expect(free.service.fill(1)).rejects.toBeInstanceOf(AutofillBlockedError);

    const pro = setup('pro');
    expect(await pro.service.blocked()).toBe('no_profile');
    await expect(pro.service.fill(1)).rejects.toMatchObject({ reason: 'no_profile' });

    // A build without accounts isn't limited.
    expect(await setup().service.allowed()).toBe(true);
  });

  it('fills every frame and merges the reports', async () => {
    const { service, calls } = setup('pro', [report(2), { filled: [], skipped: [], files: [] }]);
    await service.saveProfile({ ...EMPTY_PROFILE, email: 'sam@example.com' });
    expect(await service.blocked()).toBeUndefined();
    const outcome = await service.fill(7);
    expect(outcome).toEqual({
      filled: report(2).filled,
      skipped: report(2).skipped,
      files: ['Resume'],
      ats: 'greenhouse',
      basic: false,
    });
    expect(calls[0]).toMatchObject({ tabId: 7, profile: { email: 'sam@example.com' } });
    expect((await service.profile()).email).toBe('sam@example.com');
  });

  it('fills the basic fields on Free, and everything on Pro', async () => {
    const full: Profile = {
      ...EMPTY_PROFILE,
      firstName: 'Sam',
      email: 'sam@example.com',
      linkedin: 'https://linkedin.com/in/sam',
      currentTitle: 'Analyst',
      salaryExpectation: '$120k',
      workAuthorization: 'yes',
      answers: [{ question: 'Why us?', answer: 'The mission.' }],
    };
    const free = setup('free', [report(1)]);
    await free.service.saveProfile(full);
    expect(await free.service.allowed()).toBe(false);
    expect((await free.service.fill(1)).basic).toBe(true);
    expect(free.calls[0]?.profile).toEqual({
      answers: [],
      firstName: 'Sam',
      email: 'sam@example.com',
      linkedin: 'https://linkedin.com/in/sam',
    });

    // Only Pro details saved: nothing Free can fill with.
    const onlyPro = setup('free');
    await onlyPro.service.saveProfile({ ...EMPTY_PROFILE, currentTitle: 'Analyst' });
    expect(await onlyPro.service.blocked()).toBe('no_profile');

    const pro = setup('pro', [report(1)]);
    await pro.service.saveProfile(full);
    expect((await pro.service.fill(1)).basic).toBe(false);
    expect(pro.calls[0]?.profile).toMatchObject({ currentTitle: 'Analyst', answers: full.answers });
  });
});
