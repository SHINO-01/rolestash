import { DEFAULT_SETTINGS } from '@/domain/settings';
import type { KeyValueStore } from './key-value-store';
import { META_KEY, SETTINGS_KEY } from './keys';

/**
 * Ordered, forward-only storage migrations.
 *
 * Rules (see docs/reference/storage.md#migrations):
 *  1. Never edit a released migration — append a new one.
 *  2. Migrations must be idempotent: they can run concurrently from the
 *     background worker and an extension page on first launch.
 *  3. Every migration ships with a unit test in tests/unit/storage/migrations.test.ts.
 */
export interface Migration {
  version: number;
  description: string;
  up: (store: KeyValueStore) => Promise<void>;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    description: 'Initial schema: seed default settings',
    up: async (store) => {
      const existing = await store.get([SETTINGS_KEY]);
      if (existing[SETTINGS_KEY] === undefined) {
        await store.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
      }
    },
  },
];

export const CURRENT_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

interface Meta {
  schemaVersion: number;
}

export class SchemaTooNewError extends Error {
  constructor(stored: number) {
    super(
      `Stored data uses schema v${stored}, but this build only understands up to v${CURRENT_SCHEMA_VERSION}. ` +
        'Update the extension instead of downgrading.',
    );
    this.name = 'SchemaTooNewError';
  }
}

export async function readSchemaVersion(store: KeyValueStore): Promise<number> {
  const result = await store.get([META_KEY]);
  const meta = result[META_KEY] as Partial<Meta> | undefined;
  return typeof meta?.schemaVersion === 'number' ? meta.schemaVersion : 0;
}

export async function migrate(
  store: KeyValueStore,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<{ from: number; to: number }> {
  const from = await readSchemaVersion(store);
  const target = migrations[migrations.length - 1]?.version ?? 0;
  if (from > target) throw new SchemaTooNewError(from);

  let version = from;
  for (const migration of migrations) {
    if (migration.version <= version) continue;
    await migration.up(store);
    version = migration.version;
    await store.set({ [META_KEY]: { schemaVersion: version } satisfies Meta });
  }
  return { from, to: version };
}
