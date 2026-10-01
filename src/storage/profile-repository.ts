import { EMPTY_PROFILE, ProfileSchema, type Profile } from '@/domain/profile';
import type { KeyValueStore } from './key-value-store';
import { PROFILE_KEY } from './keys';

/**
 * The autofill profile (ADR-0020). One key, on this device only: it isn't
 * synced and isn't part of backups.
 */
export class ProfileRepository {
  constructor(private readonly store: KeyValueStore) {}

  async get(): Promise<Profile> {
    const raw = (await this.store.get([PROFILE_KEY]))[PROFILE_KEY];
    const parsed = ProfileSchema.safeParse(raw ?? EMPTY_PROFILE);
    return parsed.success ? parsed.data : structuredClone(EMPTY_PROFILE);
  }

  async save(profile: Profile, now: Date = new Date()): Promise<Profile> {
    const next = ProfileSchema.parse({ ...profile, updatedAt: now.toISOString() });
    await this.store.set({ [PROFILE_KEY]: next });
    return next;
  }

  async clear(): Promise<void> {
    await this.store.remove([PROFILE_KEY]);
  }

  subscribe(listener: () => void): () => void {
    return this.store.subscribe((changes) => {
      if (PROFILE_KEY in changes) listener();
    });
  }
}
