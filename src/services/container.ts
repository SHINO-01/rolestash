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
): Services {
  const jobs = new JobRepository(store);
  const settings = new SettingsRepository(store);
  const account = backend
    ? new AccountService(store, backend.client, backend.authFlow, ctx.now)
    : undefined;
  return {
    store,
    jobs,
    settings,
    runner,
    ...(account ? { account } : {}),
    jobService: new JobService(jobs, settings, ctx, account),
    columns: new ColumnService(settings, jobs, ctx, account),
    capture: new CaptureService(runner),
    ready: migrate(store).then(() => undefined),
  };
}
