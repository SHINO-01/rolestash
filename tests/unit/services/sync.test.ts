import type { Job } from '@/domain/job';
import type { Plan } from '@/domain/plan';
import {
  BackendError,
  type PulledChange,
  type RemoteDevice,
  type SyncChange,
} from '@/services/backend/supabase-client';
import { JobService } from '@/services/job-service';
import type { RemoteJobStore } from '@/services/ports';
import { SETTINGS_ROW, SyncService } from '@/services/sync-service';
import { JobRepository } from '@/storage/job-repository';
import { MemoryKeyValueStore } from '@/storage/key-value-store';
import { SYNC_LOCK_KEY } from '@/storage/keys';
import { migrate } from '@/storage/migrations';
import { SettingsRepository } from '@/storage/settings-repository';
import { makeJob, testContext } from '../helpers/factories';

/** Mirrors the SQL in supabase/migrations/…_sync.sql (ADR-0016). */
class FakeServer {
  rows = new Map<string, PulledChange>();
  devices: RemoteDevice[] = [];
  revision = 0;
  limit = 3;
  failNext?: BackendError;

  store(): RemoteJobStore {
    const check = (deviceId: string) => {
      if (this.failNext) {
        const e = this.failNext;
        this.failNext = undefined;
        throw e;
      }
      if (!this.devices.some((d) => d.id === deviceId))
        throw new BackendError('sync_not_allowed', 403);
    };
    return {
      registerDevice: (device) => {
        if (this.devices.some((d) => d.id === device.id)) return Promise.resolve({ ok: true });
        if (this.devices.length >= this.limit)
          return Promise.resolve({ ok: false, reason: 'device_limit', limit: this.limit });
        this.devices.push({ ...device, createdAt: 'x', lastSeenAt: 'x' });
        return Promise.resolve({ ok: true });
      },
      listDevices: () => Promise.resolve([...this.devices]),
      removeDevice: (id) => {
        this.devices = this.devices.filter((d) => d.id !== id);
        return Promise.resolve();
      },
      push: (deviceId, changes: SyncChange[]) => {
        check(deviceId);
        let applied = 0;
        for (const c of changes) {
          const current = this.rows.get(c.id);
          if (current && current.updatedAt >= c.updatedAt) continue;
          this.rows.set(c.id, {
            id: c.id,
            data: c.deleted ? null : structuredClone(c.data),
            deleted: c.deleted ?? false,
            updatedAt: c.updatedAt,
            revision: ++this.revision,
          });
          applied++;
        }
        return Promise.resolve(applied);
      },
      pull: (deviceId, after, limit) => {
        check(deviceId);
        return Promise.resolve(
          [...this.rows.values()]
            .filter((r) => r.revision > after)
            .sort((a, b) => a.revision - b.revision)
            .slice(0, limit)
            .map((r) => structuredClone(r)),
        );
      },
    };
  }
}

async function device(
  server: FakeServer,
  name: string,
  opts: { plan?: Plan; start?: string; ctx?: ReturnType<typeof testContext> } = {},
) {
  const store = new MemoryKeyValueStore();
  await migrate(store);
  const jobs = new JobRepository(store);
  const settings = new SettingsRepository(store);
  const ctx = opts.ctx ?? testContext(opts.start);
  let id = 0;
  const ids = { ...ctx, newId: () => `${name}-${String(++id)}` };
  const account = {
    currentPlan: () => Promise.resolve(opts.plan ?? 'pro'),
    state: () => Promise.resolve({ signedIn: true }),
  };
  const sync = new SyncService(store, jobs, settings, server.store(), account, ids, {
    name,
    kind: 'computer',
  });
  const service = new JobService(jobs, settings, ctx);
  return { store, jobs, settings, sync, ctx, service };
}

const titles = async (jobs: JobRepository) => (await jobs.list()).map((j) => j.title).sort();

describe('SyncService', () => {
  it('registers devices up to the plan limit', async () => {
    const server = new FakeServer();
    server.limit = 1;
    const a = await device(server, 'a');
    const b = await device(server, 'b');
    expect(await a.sync.enable()).toEqual({ ok: true });
    expect(await b.sync.enable()).toEqual({ ok: false, reason: 'device_limit', limit: 1 });
    expect((await b.sync.state()).enabled).toBe(false);
    expect((await a.sync.devices()).map((d) => d.name)).toEqual(['a']);
    // Removing a device frees the place.
    await b.sync.removeDevice('a-1');
    expect(await b.sync.enable()).toEqual({ ok: true });
  });

  it('merges two boards both ways on first sync', async () => {
    const server = new FakeServer();
    const a = await device(server, 'a');
    const b = await device(server, 'b');
    await a.jobs.save(makeJob({ id: 'ja', title: 'From A' }));
    await b.jobs.save(makeJob({ id: 'jb', title: 'From B' }));
    await a.sync.enable();
    await b.sync.enable();
    await a.sync.sync();
    await b.sync.sync();
    await a.sync.sync();
    expect(await titles(a.jobs)).toEqual(['From A', 'From B']);
    expect(await titles(b.jobs)).toEqual(['From A', 'From B']);
    // Nothing left to push once in step.
    expect((await a.sync.sync()).pushed).toBe(0);
  });

  it('keeps the newest edit when both devices changed the same job', async () => {
    const server = new FakeServer();
    const a = await device(server, 'a');
    const b = await device(server, 'b');
    await a.jobs.save(
      makeJob({ id: 'j', title: 'Original', updatedAt: '2026-10-01T00:00:00.000Z' }),
    );
    await a.sync.enable();
    await b.sync.enable();
    await a.sync.sync();
    await b.sync.sync();

    await a.jobs.save(
      makeJob({ id: 'j', title: 'Edited on A', updatedAt: '2026-10-01T01:00:00.000Z' }),
    );
    await b.jobs.save(
      makeJob({ id: 'j', title: 'Edited on B', updatedAt: '2026-10-01T02:00:00.000Z' }),
    );
    await b.sync.sync();
    await a.sync.sync(); // A's older edit loses on the server, then A pulls B's
    await b.sync.sync();
    expect(await titles(a.jobs)).toEqual(['Edited on B']);
    expect(await titles(b.jobs)).toEqual(['Edited on B']);
  });

  it('carries deletions as tombstones', async () => {
    const server = new FakeServer();
    const a = await device(server, 'a', { start: '2026-10-01T05:00:00.000Z' });
    const b = await device(server, 'b');
    await a.jobs.save(makeJob({ id: 'j', title: 'Gone soon' }));
    await a.sync.enable();
    await b.sync.enable();
    await a.sync.sync();
    await b.sync.sync();
    expect(await titles(b.jobs)).toEqual(['Gone soon']);

    await a.jobs.delete('j');
    await a.sync.sync();
    await b.sync.sync();
    expect(await b.jobs.list()).toEqual([]);
    expect(server.rows.get('j')?.deleted).toBe(true);
  });

  it('syncs columns but not the theme', async () => {
    const server = new FakeServer();
    const a = await device(server, 'a', { start: '2026-10-01T05:00:00.000Z' });
    const b = await device(server, 'b');
    await a.sync.enable();
    await b.sync.enable();
    const s = await a.settings.get();
    await a.settings.replace({
      ...s,
      theme: 'dark',
      stages: s.stages.map((x) => (x.id === 'saved' ? { ...x, name: 'Wishlist' } : x)),
    });
    await a.sync.sync();
    await b.sync.sync();
    const theirs = await b.settings.get();
    expect(theirs.stages[0]?.name).toBe('Wishlist');
    expect(theirs.theme).toBe('system');
    expect(server.rows.get(SETTINGS_ROW)?.data).not.toHaveProperty('theme');
  });

  it('skips invalid or mismatched rows from the server', async () => {
    const server = new FakeServer();
    const a = await device(server, 'a');
    await a.sync.enable();
    server.rows.set('bad', {
      id: 'bad',
      data: { title: 1 },
      deleted: false,
      updatedAt: '2026-10-01T00:00:00.000Z',
      revision: 1,
    });
    server.rows.set('liar', {
      id: 'liar',
      data: makeJob({ id: 'other' }),
      deleted: false,
      updatedAt: '2026-10-01T00:00:00.000Z',
      revision: 2,
    });
    server.revision = 2;
    expect((await a.sync.sync()).pulled).toBe(0);
    expect(await a.jobs.list()).toEqual([]);
  });

  it('does nothing when off, on Free, or while another context syncs', async () => {
    const server = new FakeServer();
    const off = await device(server, 'off');
    expect(await off.sync.sync()).toMatchObject({ skipped: 'off' });
    const free = await device(server, 'free', { plan: 'free' });
    await free.sync.enable();
    expect(await free.sync.sync()).toMatchObject({ skipped: 'free' });
    const busy = await device(server, 'busy');
    await busy.sync.enable();
    await busy.store.set({ [SYNC_LOCK_KEY]: Date.parse('2026-09-28T00:00:30.000Z') });
    expect(await busy.sync.sync()).toMatchObject({ skipped: 'busy' });
  });

  it('records why a sync failed, and clears it after a good run', async () => {
    const server = new FakeServer();
    const a = await device(server, 'a');
    await a.sync.enable();
    server.failNext = new BackendError('network');
    await expect(a.sync.sync()).rejects.toThrow(BackendError);
    expect((await a.sync.state()).problem).toBe('offline');
    await a.sync.sync();
    expect((await a.sync.state()).problem).toBeUndefined();

    await a.sync.removeDevice('a-1'); // removing this device turns sync off here
    expect((await a.sync.state()).enabled).toBe(false);
    const b = await device(server, 'b');
    await b.sync.enable();
    server.devices = []; // removed from another device
    await expect(b.sync.sync()).rejects.toThrow(BackendError);
    expect((await b.sync.state()).problem).toBe('not_allowed');
  });
});

describe('SyncService: two devices editing the same jobs offline', () => {
  const MIN = 60_000;
  const board = async (jobs: JobRepository) =>
    Object.fromEntries((await jobs.list()).map((j) => [j.id, j.title]));

  /** Two devices on one clock, both holding job "j" in step. */
  async function pair() {
    const server = new FakeServer();
    const clock = testContext('2026-10-01T00:00:00.000Z');
    const a = await device(server, 'a', { ctx: clock });
    const b = await device(server, 'b', { ctx: clock });
    await a.jobs.save(
      makeJob({ id: 'j', title: 'Original', updatedAt: clock.now().toISOString() }),
    );
    await a.sync.enable();
    await b.sync.enable();
    await a.sync.sync();
    await b.sync.sync();
    return { server, clock, a, b };
  }

  it('keeps an edit made after the job was deleted on the other device', async () => {
    const { clock, a, b } = await pair();
    clock.advance(MIN);
    await b.service.remove('j'); // B deletes first…
    clock.advance(MIN);
    await a.service.update('j', { title: 'Edited later on A' }); // …A edits afterwards
    clock.advance(60 * MIN);
    await b.sync.sync(); // B comes online first, long after both changes
    await a.sync.sync();
    await b.sync.sync();
    expect(await board(a.jobs)).toEqual({ j: 'Edited later on A' });
    expect(await board(b.jobs)).toEqual({ j: 'Edited later on A' });
  });

  it('keeps a deletion made after the job was edited on the other device', async () => {
    const { clock, a, b } = await pair();
    clock.advance(MIN);
    await b.service.update('j', { title: 'Edited on B' }); // B edits first…
    clock.advance(MIN);
    await a.service.remove('j'); // …A deletes afterwards
    clock.advance(60 * MIN);
    await b.sync.sync(); // B's older edit reaches the server first
    await a.sync.sync();
    await b.sync.sync();
    expect(await board(a.jobs)).toEqual({});
    expect(await board(b.jobs)).toEqual({});
  });

  it('brings a job back everywhere when its deletion is undone after syncing', async () => {
    const { server, clock, a, b } = await pair();
    clock.advance(MIN);
    const removed = await a.service.remove('j');
    clock.advance(3000);
    await a.sync.sync(); // the board syncs 3 s after a change; the undo toast lasts longer
    await b.sync.sync();
    expect(await board(b.jobs)).toEqual({});
    clock.advance(2000);
    await a.service.restore(removed!);
    clock.advance(3000);
    await a.sync.sync();
    await b.sync.sync();
    expect(await board(a.jobs)).toEqual({ j: 'Original' });
    expect(await board(b.jobs)).toEqual({ j: 'Original' });
    expect(server.rows.get('j')?.deleted).toBe(false);
  });

  it('does not bring back jobs deleted while sync was off', async () => {
    const { clock, a, b } = await pair();
    await a.sync.disable();
    clock.advance(MIN);
    await a.service.remove('j');
    clock.advance(MIN);
    await a.sync.enable(); // a fresh start merges both ways
    await a.sync.sync();
    await b.sync.sync();
    expect(await board(a.jobs)).toEqual({});
    expect(await board(b.jobs)).toEqual({});
  });

  it('ends with the same board on both devices, whatever the order of edits, deletes, undos and syncs', async () => {
    // A small deterministic PRNG, so a failure always replays the same way.
    let seed = 20261003;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)] as T;

    for (let round = 0; round < 20; round++) {
      const server = new FakeServer();
      const clock = testContext('2026-10-01T00:00:00.000Z');
      const a = await device(server, 'a', { ctx: clock });
      const b = await device(server, 'b', { ctx: clock });
      for (const id of ['j1', 'j2', 'j3', 'j4'])
        await a.jobs.save(makeJob({ id, title: `${id} v0`, updatedAt: clock.now().toISOString() }));
      await a.sync.enable();
      await b.sync.enable();
      await a.sync.sync();
      await b.sync.sync();

      const undo = new Map<object, Job[]>([
        [a, []],
        [b, []],
      ]);
      let edits = 0;
      for (let step = 0; step < 40; step++) {
        clock.advance(1 + Math.floor(random() * 10_000));
        const d = pick([a, b]);
        const present = (await d.jobs.list()).map((j) => j.id).sort();
        const op = pick(['edit', 'edit', 'delete', 'undo', 'sync', 'sync']);
        if (op === 'edit' && present.length)
          await d.service.update(pick(present), { title: `edit ${String(++edits)}` });
        else if (op === 'delete' && present.length) {
          const gone = await d.service.remove(pick(present));
          if (gone) undo.get(d)?.push(gone);
        } else if (op === 'undo') {
          const last = undo.get(d)?.pop();
          if (last && !(await d.jobs.get(last.id))) await d.service.restore(last);
        } else if (op === 'sync') await d.sync.sync();
      }
      clock.advance(MIN);
      await a.sync.sync();
      await b.sync.sync();
      await a.sync.sync();
      expect({ round, board: await board(b.jobs) }).toEqual({ round, board: await board(a.jobs) });
    }
  });
});
