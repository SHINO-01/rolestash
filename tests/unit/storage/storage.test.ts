import { DEFAULT_SETTINGS } from '@/domain/settings';
import { BackupError, createBackup, parseBackup, restoreBackup } from '@/storage/backup';
import { JobRepository } from '@/storage/job-repository';
import { MemoryKeyValueStore } from '@/storage/key-value-store';
import {
  CURRENT_SCHEMA_VERSION,
  migrate,
  SchemaTooNewError,
  type Migration,
} from '@/storage/migrations';
import { SettingsRepository } from '@/storage/settings-repository';
import { makeJob } from '../helpers/factories';

function setup(initial: Record<string, unknown> = {}) {
  const store = new MemoryKeyValueStore(initial);
  return { store, jobs: new JobRepository(store), settings: new SettingsRepository(store) };
}

describe('JobRepository', () => {
  it('round-trips jobs and ignores non-job keys', async () => {
    const { jobs, store } = setup({ settings: DEFAULT_SETTINGS });
    const job = makeJob({ id: 'a' });
    await jobs.save(job);
    expect(await jobs.list()).toEqual([job]);
    expect(await jobs.get('a')).toEqual(job);
    expect(Object.keys(await store.get(null))).toEqual(['settings', 'job:a']);
  });

  it('rejects invalid jobs on write', async () => {
    const { jobs } = setup();
    await expect(jobs.save({ ...makeJob(), title: '' })).rejects.toThrow();
  });

  it('skips corrupt records on read instead of failing the whole board', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { jobs } = setup({ 'job:bad': { nope: true }, 'job:ok': makeJob({ id: 'ok' }) });
    expect((await jobs.list()).map((j) => j.id)).toEqual(['ok']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('notifies subscribers only for job changes', async () => {
    const { jobs, settings } = setup();
    const listener = vi.fn();
    const unsubscribe = jobs.subscribe(listener);
    await settings.update({ theme: 'dark' });
    expect(listener).not.toHaveBeenCalled();
    await jobs.save(makeJob({ id: 'x' }));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    await jobs.delete('x');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('SettingsRepository', () => {
  it('falls back to defaults and validates updates', async () => {
    const { settings } = setup();
    expect(await settings.get()).toEqual(DEFAULT_SETTINGS);
    expect((await settings.update({ theme: 'light' })).theme).toBe('light');
    await expect(settings.update({ defaultStageId: 'missing' })).rejects.toThrow();
  });
});

describe('migrations', () => {
  it('seeds a fresh install and records the schema version', async () => {
    const { store } = setup();
    expect(await migrate(store)).toEqual({ from: 0, to: CURRENT_SCHEMA_VERSION });
    const data = await store.get(null);
    expect(data.meta).toEqual({ schemaVersion: CURRENT_SCHEMA_VERSION });
    expect(data.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('is idempotent', async () => {
    const { store } = setup();
    await migrate(store);
    expect(await migrate(store)).toEqual({
      from: CURRENT_SCHEMA_VERSION,
      to: CURRENT_SCHEMA_VERSION,
    });
  });

  it('never overwrites existing settings', async () => {
    const { store, settings } = setup({ settings: { ...DEFAULT_SETTINGS, theme: 'dark' } });
    await migrate(store);
    expect((await settings.get()).theme).toBe('dark');
  });

  it('runs only pending migrations, in order', async () => {
    const { store } = setup({ meta: { schemaVersion: 1 } });
    const calls: number[] = [];
    const migrations: Migration[] = [1, 2, 3].map((version) => ({
      version,
      description: `v${version}`,
      up: () => {
        calls.push(version);
        return Promise.resolve();
      },
    }));
    expect(await migrate(store, migrations)).toEqual({ from: 1, to: 3 });
    expect(calls).toEqual([2, 3]);
  });

  it('refuses to run on data from a newer build', async () => {
    const { store } = setup({ meta: { schemaVersion: 999 } });
    await expect(migrate(store)).rejects.toBeInstanceOf(SchemaTooNewError);
  });
});

describe('backup', () => {
  it('exports and re-imports losslessly (replace)', async () => {
    const a = setup({ settings: { ...DEFAULT_SETTINGS, theme: 'dark' } });
    await a.jobs.saveMany([makeJob({ id: '1' }), makeJob({ id: '2' })]);
    const text = JSON.stringify(
      await createBackup(a.jobs, a.settings, new Date('2026-09-28T00:00:00Z')),
    );

    const b = setup();
    await b.jobs.save(makeJob({ id: 'old' }));
    const summary = await restoreBackup(parseBackup(text), 'replace', b.jobs, b.settings);
    expect(summary).toEqual({ added: 2, updated: 0, skipped: 0, removed: 1 });
    expect((await b.jobs.list()).map((j) => j.id).sort()).toEqual(['1', '2']);
    expect((await b.settings.get()).theme).toBe('dark');
  });

  it('merge keeps the newest version of each job and remaps unknown stages', async () => {
    const target = setup();
    await target.jobs.saveMany([
      makeJob({ id: 'same', updatedAt: '2026-09-10T00:00:00.000Z', title: 'Local newer' }),
      makeJob({ id: 'older', updatedAt: '2026-09-01T00:00:00.000Z', title: 'Local older' }),
    ]);
    const backup = {
      format: 'rolestash-backup',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      exportedAt: '2026-09-28T00:00:00.000Z',
      settings: DEFAULT_SETTINGS,
      jobs: [
        makeJob({ id: 'same', updatedAt: '2026-09-05T00:00:00.000Z', title: 'Backup older' }),
        makeJob({ id: 'older', updatedAt: '2026-09-20T00:00:00.000Z', title: 'Backup newer' }),
        makeJob({ id: 'new', stageId: 'custom-stage' }),
      ],
    };
    const summary = await restoreBackup(
      parseBackup(JSON.stringify(backup)),
      'merge',
      target.jobs,
      target.settings,
    );
    expect(summary).toEqual({ added: 1, updated: 1, skipped: 1, removed: 0 });
    const byId = Object.fromEntries((await target.jobs.list()).map((j) => [j.id, j]));
    expect(byId.same?.title).toBe('Local newer');
    expect(byId.older?.title).toBe('Backup newer');
    expect(byId.new?.stageId).toBe(DEFAULT_SETTINGS.defaultStageId);
  });

  it('still imports backups exported under the old Jobtrail name', () => {
    const legacy = {
      format: 'jobtrail-backup',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      exportedAt: '2026-09-28T00:00:00.000Z',
      settings: DEFAULT_SETTINGS,
      jobs: [makeJob({ id: 'legacy' })],
    };
    const backup = parseBackup(JSON.stringify(legacy));
    expect(backup.format).toBe('rolestash-backup');
    expect(backup.jobs.map((j) => j.id)).toEqual(['legacy']);
  });

  it.each([
    ['not json', /not valid JSON/],
    ['{"format":"other"}', /not a Rolestash backup/],
    [JSON.stringify({ format: 'rolestash-backup', schemaVersion: 999 }), /newer version/],
    [
      JSON.stringify({
        format: 'rolestash-backup',
        schemaVersion: 1,
        exportedAt: 'x',
        settings: {},
        jobs: [],
      }),
      /damaged/,
    ],
  ])('rejects bad files: %s', (text, message) => {
    expect(() => parseBackup(text)).toThrow(BackupError);
    expect(() => parseBackup(text)).toThrow(message);
  });
});
