import { JobSchema, type Job } from '@/domain/job';
import type { DomainContext } from '@/domain/job-factory';
import type { Plan } from '@/domain/plan';
import { SettingsSchema, type Settings } from '@/domain/settings';
import type { JobRepository } from '@/storage/job-repository';
import type { KeyValueStore } from '@/storage/key-value-store';
import { SYNC_LOCK_KEY, SYNC_STATE_KEY } from '@/storage/keys';
import type { SettingsRepository } from '@/storage/settings-repository';
import {
  BackendError,
  type DeviceRegistration,
  type PulledChange,
  type RemoteDevice,
  type SyncChange,
} from './backend/supabase-client';
import type { RemoteJobStore } from './ports';

/**
 * Sync across devices (Pro and Advanced; ADR-0016). Local storage stays the
 * source of truth: a run pulls what changed on the server, then pushes what
 * changed here. The newest `updatedAt` wins per job; deletions travel as
 * tombstones. The server enforces plans and device limits.
 */

const PAGE = 500;
const PUSH_BATCH = 200;
const LOCK_MS = 60_000;
/** The board's settings travel as one more row. */
export const SETTINGS_ROW = '@settings';
/** Settings that follow you between devices; the theme stays per device. */
const SYNCED_SETTINGS = ['stages', 'defaultStageId', 'closingAlerts'] as const;

export type SyncProblem =
  /** This device was removed elsewhere, or the plan no longer allows sync. */
  'not_allowed' | 'signed_out' | 'offline' | 'error';

export interface SyncState {
  enabled: boolean;
  deviceId?: string;
  /** Highest server revision pulled. */
  cursor: number;
  /** jobId → updatedAt as last synced; differences are local changes. */
  seen: Record<string, string>;
  /** The synced settings as last synced (JSON), and when they changed. */
  settingsSnapshot?: string;
  settingsAt?: string;
  lastSyncAt?: string;
  problem?: SyncProblem;
}

export interface SyncResult {
  pulled: number;
  pushed: number;
  skipped?: 'off' | 'free' | 'busy';
}

const INITIAL: SyncState = { enabled: false, cursor: 0, seen: {} };

export interface SyncAccount {
  currentPlan(): Promise<Plan>;
  state(): Promise<{ signedIn: boolean }>;
}

export interface ThisDevice {
  name: string;
  kind: RemoteDevice['kind'];
}

function syncedSettings(settings: Settings): Record<string, unknown> {
  return Object.fromEntries(
    SYNCED_SETTINGS.filter((k) => settings[k] !== undefined).map((k) => [k, settings[k]]),
  );
}

export class SyncService {
  constructor(
    private readonly store: KeyValueStore,
    private readonly jobs: JobRepository,
    private readonly settings: SettingsRepository,
    private readonly remote: RemoteJobStore,
    private readonly account: SyncAccount,
    private readonly ctx: DomainContext,
    private readonly device: ThisDevice,
  ) {}

  async state(): Promise<SyncState> {
    const raw = (await this.store.get([SYNC_STATE_KEY]))[SYNC_STATE_KEY] as SyncState | undefined;
    return raw ? { ...INITIAL, ...raw } : { ...INITIAL };
  }

  private async save(state: SyncState): Promise<void> {
    await this.store.set({ [SYNC_STATE_KEY]: state });
  }

  /** Registers this device and turns sync on, unless the plan's limit is reached. */
  async enable(): Promise<DeviceRegistration> {
    const state = await this.state();
    const deviceId = state.deviceId ?? this.ctx.newId();
    const result = await this.remote.registerDevice({ id: deviceId, ...this.device });
    // A fresh start merges everything both ways on the first run.
    if (result.ok) await this.save({ ...INITIAL, enabled: true, deviceId });
    return result;
  }

  /** Stops syncing this device and frees its place. Local data stays. */
  async disable(): Promise<void> {
    const state = await this.state();
    if (state.deviceId) await this.remote.removeDevice(state.deviceId).catch(() => undefined);
    await this.save({ ...INITIAL, ...(state.deviceId ? { deviceId: state.deviceId } : {}) });
  }

  devices(): Promise<RemoteDevice[]> {
    return this.remote.listDevices();
  }

  /** Removes a device; removing this one turns sync off here. */
  async removeDevice(id: string): Promise<void> {
    const state = await this.state();
    if (id === state.deviceId) return this.disable();
    await this.remote.removeDevice(id);
  }

  async sync(): Promise<SyncResult> {
    let state = await this.state();
    if (!state.enabled || !state.deviceId) return { pulled: 0, pushed: 0, skipped: 'off' };
    if ((await this.account.currentPlan()) === 'free')
      return { pulled: 0, pushed: 0, skipped: 'free' };
    if (!(await this.lock())) return { pulled: 0, pushed: 0, skipped: 'busy' };
    try {
      const pulled = await this.pull(state);
      const pushed = await this.push(state);
      state = { ...state, lastSyncAt: this.ctx.now().toISOString() };
      delete state.problem;
      await this.save(state);
      return { pulled, pushed };
    } catch (error) {
      const problem: SyncProblem =
        error instanceof BackendError
          ? error.code === 'sync_not_allowed'
            ? 'not_allowed'
            : error.code === 'session_expired'
              ? 'signed_out'
              : error.code === 'network'
                ? 'offline'
                : 'error'
          : 'error';
      await this.save({ ...state, problem });
      throw error;
    } finally {
      await this.unlock();
    }
  }

  /** Applies server changes newer than the local copies. Mutates `state`. */
  private async pull(state: SyncState): Promise<number> {
    const deviceId = state.deviceId ?? '';
    let applied = 0;
    for (;;) {
      const rows = await this.remote.pull(deviceId, state.cursor, PAGE);
      if (rows.length === 0) break;
      const local = new Map((await this.jobs.list()).map((j) => [j.id, j]));
      const toSave: Job[] = [];
      for (const row of rows) {
        state.cursor = Math.max(state.cursor, row.revision);
        if (row.id === SETTINGS_ROW) {
          if (await this.applySettings(row, state)) applied++;
          continue;
        }
        const mine = local.get(row.id);
        if (row.deleted) {
          if (mine && mine.updatedAt <= row.updatedAt) {
            await this.jobs.delete(row.id);
            applied++;
          }
          if (!mine || mine.updatedAt <= row.updatedAt) Reflect.deleteProperty(state.seen, row.id);
          continue;
        }
        // Missing here but synced at this version or later: deleted on this
        // device since. Don't resurrect it; the tombstone goes out in push().
        const seenAt = state.seen[row.id];
        if (!mine && seenAt !== undefined && row.updatedAt <= seenAt) continue;
        const parsed = JobSchema.safeParse(row.data);
        if (!parsed.success || parsed.data.id !== row.id) continue; // never trust shape blindly
        if (!mine || parsed.data.updatedAt > mine.updatedAt) {
          toSave.push(parsed.data);
          state.seen[row.id] = parsed.data.updatedAt;
        } else if (parsed.data.updatedAt === mine.updatedAt) {
          state.seen[row.id] = mine.updatedAt;
        }
      }
      if (toSave.length) {
        await this.jobs.saveMany(toSave);
        applied += toSave.length;
      }
      await this.save(state);
      if (rows.length < PAGE) break;
    }
    return applied;
  }

  private async applySettings(row: PulledChange, state: SyncState): Promise<boolean> {
    if (row.deleted || (state.settingsAt && row.updatedAt <= state.settingsAt)) return false;
    const current = await this.settings.get();
    const incoming = (row.data ?? {}) as Record<string, unknown>;
    const merged = SettingsSchema.safeParse({
      ...current,
      ...Object.fromEntries(
        SYNCED_SETTINGS.filter((k) => k in incoming).map((k) => [k, incoming[k]]),
      ),
    });
    if (!merged.success) return false;
    await this.settings.replace(merged.data);
    state.settingsSnapshot = JSON.stringify(syncedSettings(merged.data));
    state.settingsAt = row.updatedAt;
    return true;
  }

  /** Pushes local edits, deletions and settings changes. Mutates `state`. */
  private async push(state: SyncState): Promise<number> {
    const deviceId = state.deviceId ?? '';
    const now = this.ctx.now().toISOString();
    const current = await this.jobs.list();
    const ids = new Set(current.map((j) => j.id));
    const changes: SyncChange[] = [
      ...current
        .filter((j) => state.seen[j.id] !== j.updatedAt)
        .map((j) => ({ id: j.id, updatedAt: j.updatedAt, data: j })),
      ...Object.keys(state.seen)
        .filter((id) => !ids.has(id))
        .map((id) => ({ id, updatedAt: now, deleted: true })),
    ];
    const settings = JSON.stringify(syncedSettings(await this.settings.get()));
    if (settings !== state.settingsSnapshot)
      changes.push({ id: SETTINGS_ROW, updatedAt: now, data: JSON.parse(settings) as unknown });

    for (let i = 0; i < changes.length; i += PUSH_BATCH) {
      const batch = changes.slice(i, i + PUSH_BATCH);
      await this.remote.push(deviceId, batch);
      for (const change of batch) {
        if (change.id === SETTINGS_ROW) {
          state.settingsSnapshot = settings;
          state.settingsAt = change.updatedAt;
        } else if (change.deleted) Reflect.deleteProperty(state.seen, change.id);
        else state.seen[change.id] = change.updatedAt;
      }
      await this.save(state);
    }
    return changes.length;
  }

  /** A storage lease, so the board and the worker don't sync at the same time. */
  private async lock(): Promise<boolean> {
    const now = this.ctx.now().getTime();
    const held = (await this.store.get([SYNC_LOCK_KEY]))[SYNC_LOCK_KEY] as number | undefined;
    if (held !== undefined && held > now) return false;
    await this.store.set({ [SYNC_LOCK_KEY]: now + LOCK_MS });
    return true;
  }

  private async unlock(): Promise<void> {
    await this.store.remove([SYNC_LOCK_KEY]);
  }
}
