import type { DomainContext } from '@/domain/job-factory';
import type { KeyValueStore } from '@/storage/key-value-store';
import { JobRepository } from '@/storage/job-repository';
import { migrate } from '@/storage/migrations';
import { SettingsRepository } from '@/storage/settings-repository';
import { AccountService } from './account-service';
import type { SupabaseClient } from './backend/supabase-client';
import { CaptureService } from './capture-service';
import { ColumnService } from './column-service';
import { JobService } from './job-service';
import { SyncService, type ThisDevice } from './sync-service';
import type { ExtractorRunner, WebAuthFlow } from './ports';

/**
 * Composition root. Each extension context (background, popup, board) builds
 * one container; tests build theirs with in-memory fakes.
 */
export interface Services {
  store: KeyValueStore;
  jobs: JobRepository;
  settings: SettingsRepository;
  jobService: JobService;
  columns: ColumnService;
  capture: CaptureService;
  runner: ExtractorRunner;
  /** Present only in builds configured with a backend (ADR-0011). */
  account?: AccountService;
  /** Sync across devices (ADR-0016); present with `account`. */
  sync?: SyncService;
  /** Resolves once storage migrations have run in this context. */
  ready: Promise<void>;
}

export const systemContext: DomainContext = {
  now: () => new Date(),
  newId: () => crypto.randomUUID(),
};

export interface BackendDeps {
  client: SupabaseClient;
  authFlow: WebAuthFlow;
}

export function createServices(
  store: KeyValueStore,
  runner: ExtractorRunner,
  ctx: DomainContext = systemContext,
  backend?: BackendDeps,
  device: ThisDevice = { name: 'This computer', kind: 'computer' },
): Services {
  const jobs = new JobRepository(store);
  const settings = new SettingsRepository(store);
  const account = backend
    ? new AccountService(store, backend.client, backend.authFlow, ctx.now)
    : undefined;
  const sync = account
    ? new SyncService(store, jobs, settings, account.remoteJobStore(), account, ctx, device)
    : undefined;
  return {
    store,
    jobs,
    settings,
    runner,
    ...(account ? { account } : {}),
    ...(sync ? { sync } : {}),
    jobService: new JobService(jobs, settings, ctx, account),
    columns: new ColumnService(settings, jobs, ctx, account),
    capture: new CaptureService(runner),
    ready: migrate(store).then(() => undefined),
  };
}
