import type { Plan } from '@/domain/plan';
import { JobRepository } from '@/storage/job-repository';
import { MemoryKeyValueStore } from '@/storage/key-value-store';
import { REMINDERS_KEY } from '@/storage/keys';
import { migrate } from '@/storage/migrations';
import { SettingsRepository } from '@/storage/settings-repository';
import {
  CLOSING_ID,
  FOLLOW_UP_PREFIX,
  FOLLOW_UPS_ID,
  ReminderService,
} from '@/services/reminder-service';
import type { Notifier } from '@/services/ports';
import { makeJob } from '../helpers/factories';

const NOW = new Date(2026, 9, 1, 10, 0);
const at = (day: number, hour = 9) => new Date(2026, 9, day, hour).toISOString();

async function setup(opts: { plan?: Plan; granted?: boolean } = {}) {
  const store = new MemoryKeyValueStore();
  await migrate(store);
  const jobs = new JobRepository(store);
  const settings = new SettingsRepository(store);
  const sent: { id: string; title: string; message: string }[] = [];
  const notifier: Notifier = {
    granted: () => Promise.resolve(opts.granted ?? true),
    notify: (id, title, message) => {
      sent.push({ id, title, message });
      return Promise.resolve();
    },
  };
  const plan = opts.plan;
  const plans = plan ? { currentPlan: () => Promise.resolve(plan) } : undefined;
  const service = new ReminderService(jobs, settings, store, notifier, plans);
  return { service, jobs, settings, store, sent };
}

describe('ReminderService', () => {
  it('notifies a due follow-up once, and the closing digest once a day', async () => {
    const { service, jobs, sent, store } = await setup({ plan: 'pro' });
    await jobs.saveMany([
      makeJob({ id: 'a', title: 'Data Analyst', company: 'Kestrel Health', followUpAt: at(1) }),
      makeJob({ id: 'b', title: 'Designer', company: 'Tidewater Studio', closesAt: '2026-10-02' }),
    ]);
    expect(await service.run(NOW)).toEqual({ followUps: 1, closing: 1 });
    expect(sent).toEqual([
      {
        id: `${FOLLOW_UP_PREFIX}a`,
        title: 'Time to follow up: Data Analyst',
        message: 'Kestrel Health. Open the card to update it.',
      },
      {
        id: CLOSING_ID,
        title: 'Closing tomorrow: Designer',
        message: 'Designer at Tidewater Studio, tomorrow',
      },
    ]);
    expect(await service.run(new Date(NOW.getTime() + 15 * 60_000))).toEqual({
      followUps: 0,
      closing: 0,
    });
    expect(sent).toHaveLength(2);
    expect(await store.get([REMINDERS_KEY])).toMatchObject({
      [REMINDERS_KEY]: { lastDigest: '2026-10-01', notified: { a: at(1) } },
    });
  });

  it('summarises many due follow-ups in one notification', async () => {
    const { service, jobs, sent } = await setup();
    await jobs.saveMany(
      Array.from({ length: 5 }, (_, i) => makeJob({ id: `j${String(i)}`, followUpAt: at(1, 8) })),
    );
    await service.run(NOW);
    expect(sent.map((s) => s.id)).toEqual([FOLLOW_UPS_ID]);
    expect(sent[0]?.title).toBe('5 follow-ups are due');
  });

  it('respects the closing-alerts setting', async () => {
    const { service, jobs, settings, sent } = await setup();
    await settings.update({ closingAlerts: false });
    await jobs.save(makeJob({ id: 'b', closesAt: '2026-10-02' }));
    expect(await service.run(NOW)).toEqual({ followUps: 0, closing: 0 });
    expect(sent).toHaveLength(0);
  });

  it('sends nothing on Free or without the permission', async () => {
    for (const opts of [{ plan: 'free' as const }, { plan: 'pro' as const, granted: false }]) {
      const { service, jobs, sent } = await setup(opts);
      await jobs.save(makeJob({ id: 'a', followUpAt: at(1) }));
      expect(await service.run(NOW)).toEqual({ followUps: 0, closing: 0 });
      expect(sent).toHaveLength(0);
    }
  });
});
