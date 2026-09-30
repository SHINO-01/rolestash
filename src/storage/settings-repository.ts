import { DEFAULT_SETTINGS, SettingsSchema, type Settings } from '@/domain/settings';
import type { KeyValueStore } from './key-value-store';
import { SETTINGS_KEY } from './keys';

export class SettingsRepository {
  constructor(private readonly store: KeyValueStore) {}

  async get(): Promise<Settings> {
    const result = await this.store.get([SETTINGS_KEY]);
    const parsed = SettingsSchema.safeParse(result[SETTINGS_KEY]);
    if (!parsed.success && result[SETTINGS_KEY] !== undefined) {
      console.warn('[rolestash] Invalid settings in storage; using defaults', parsed.error.issues);
    }
    return parsed.success ? parsed.data : structuredClone(DEFAULT_SETTINGS);
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    const next = SettingsSchema.parse({ ...(await this.get()), ...patch });
    await this.store.set({ [SETTINGS_KEY]: next });
    return next;
  }

  async replace(settings: Settings): Promise<Settings> {
    const next = SettingsSchema.parse(settings);
    await this.store.set({ [SETTINGS_KEY]: next });
    return next;
  }

  subscribe(listener: () => void): () => void {
    return this.store.subscribe((changes) => {
      if (SETTINGS_KEY in changes) listener();
    });
  }
}
