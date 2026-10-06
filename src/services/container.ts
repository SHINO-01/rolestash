import type { DomainContext } from '@/domain/job-factory';
import type { KeyValueStore } from '@/storage/key-value-store';
import { JobRepository } from '@/storage/job-repository';
import { migrate } from '@/storage/migrations';
import { SettingsRepository } from '@/storage/settings-repository';
import { ProfileRepository } from '@/storage/profile-repository';
import { AccountService } from './account-service';
import { FeedbackService, type AboutThisCopy } from './feedback-service';
import { AutofillService } from './autofill-service';
import type { SupabaseClient } from './backend/supabase-client';
import { CaptureService } from './capture-service';
import { ColumnService } from './column-service';
import { EmailUpdateService } from './email-update-service';
import { MailboxService, type MailConfig } from './mailbox-service';
import { JobService } from './job-service';
import { SyncService, type ThisDevice } from './sync-service';
import type { AutofillRunner, ExtractorRunner, WebAuthFlow } from './ports';

/**
 * Composition root. Each extension context (background, widget, board) builds
 * one container; tests build theirs with in-memory fakes.
 */
export interface Services {
  store: KeyValueStore;
  jobs: JobRepository;
  settings: SettingsRepository;
  jobService: JobService;
  columns: ColumnService;
  capture: CaptureService;
  /** Application autofill (Pro; ADR-0020); present where pages can be filled. */
  autofill?: AutofillService;
  runner: ExtractorRunner;
  /** Present only in builds configured with a backend (ADR-0011). */
  account?: AccountService;
  /** Store-rating prompt and bug reports (ADR-0024). */
  feedback: FeedbackService;
  /** Sync across devices (ADR-0016); present with `account`. */
  sync?: SyncService;
  /** Email status updates (Pro; ADR-0014); present with `account`. */
  email?: EmailUpdateService;
  /** A connected Gmail or Outlook mailbox (Pro; ADR-0032); present when the build can connect one. */
  mailbox?: MailboxService;
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
  /** OAuth client IDs for connecting Gmail or Outlook (ADR-0032), and how to reach them. */
  mail?: { config: MailConfig; fetch: typeof fetch };
}

export function createServices(
  store: KeyValueStore,
  runner: ExtractorRunner,
  ctx: DomainContext = systemContext,
  backend?: BackendDeps,
  device: ThisDevice = { name: 'This computer', kind: 'computer' },
  autofillRunner?: AutofillRunner,
  about: AboutThisCopy = { version: 'unknown', browser: 'unknown' },
): Services {
  const jobs = new JobRepository(store);
  const settings = new SettingsRepository(store);
  const account = backend
    ? new AccountService(store, backend.client, backend.authFlow, ctx.now)
    : undefined;
  const sync = account
    ? new SyncService(store, jobs, settings, account.remoteJobStore(), account, ctx, device)
    : undefined;
  const jobService = new JobService(jobs, settings, ctx, account);
  const mailbox =
    account &&
    backend?.mail &&
    (backend.mail.config.googleClientId || backend.mail.config.microsoftClientId)
      ? new MailboxService(store, backend.authFlow, backend.mail.fetch, backend.mail.config, ctx)
      : undefined;
  const email = account
    ? new EmailUpdateService(
        store,
        jobs,
        settings,
        jobService,
        account.emailInbox(),
        account,
        ctx,
        mailbox,
      )
    : undefined;
  return {
    store,
    jobs,
    settings,
    runner,
    ...(mailbox ? { mailbox } : {}),
    ...(account ? { account } : {}),
    ...(sync ? { sync } : {}),
    ...(email ? { email } : {}),
    ...(autofillRunner
      ? { autofill: new AutofillService(new ProfileRepository(store), autofillRunner, account) }
      : {}),
    jobService,
    columns: new ColumnService(settings, jobs, ctx, account),
    capture: new CaptureService(runner),
    feedback: new FeedbackService(store, jobs, ctx, about, backend?.client, account),
    ready: migrate(store).then(() => undefined),
  };
}
