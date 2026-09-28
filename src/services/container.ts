import type { DomainContext } from '@/domain/job-factory';
import type { KeyValueStore } from '@/storage/key-value-store';
import { JobRepository } from '@/storage/job-repository';
import { migrate } from '@/storage/migrations';
import { SettingsRepository } from '@/storage/settings-repository';
import { CaptureService } from './capture-service';
import { JobService } from './job-service';
import type { ExtractorRunner } from './ports';

/**
 * Composition root. Each extension context (background, popup, board) builds
 * one container; tests build theirs with in-memory fakes.
 */
export interface Services {
  store: KeyValueStore;
  jobs: JobRepository;
  settings: SettingsRepository;
  jobService: JobService;
  capture: CaptureService;
  runner: ExtractorRunner;
  /** Resolves once storage migrations have run in this context. */
  ready: Promise<void>;
}

export const systemContext: DomainContext = {
  now: () => new Date(),
  newId: () => crypto.randomUUID(),
};

export function createServices(
  store: KeyValueStore,
  runner: ExtractorRunner,
  ctx: DomainContext = systemContext,
): Services {
  const jobs = new JobRepository(store);
  const settings = new SettingsRepository(store);
  return {
    store,
    jobs,
    settings,
    runner,
    jobService: new JobService(jobs, settings, ctx),
    capture: new CaptureService(runner),
    ready: migrate(store).then(() => undefined),
  };
}
