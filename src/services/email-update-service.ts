import { z } from 'zod';
import {
  EMAIL_UPDATE_INTENTS,
  JobInterviewSchema,
  type EmailNote,
  type EmailUpdateIntent,
  type Job,
  type JobInterview,
} from '@/domain/job';
import type { DomainContext } from '@/domain/job-factory';
import type { Plan } from '@/domain/plan';
import { findStage } from '@/domain/stage';
import {
  analyzeEmail,
  EmailEventSchema,
  isPlatformDomain,
  matchEvent,
  normalizeCompany,
  targetStage,
  VOTE_TICKET,
  type EmailEvent,
} from '@/email';
import type { JobRepository } from '@/storage/job-repository';
import type { KeyValueStore } from '@/storage/key-value-store';
import { EMAIL_LOCK_KEY, EMAIL_STATE_KEY } from '@/storage/keys';
import type { SettingsRepository } from '@/storage/settings-repository';
import { BackendError, type InboxInfo, type KnowledgeVote } from './backend/supabase-client';
import { DuplicateJobError, type JobService } from './job-service';
import type { MailItem } from './mailbox-service';
import type { EmailInbox } from './ports';

/** A connected Gmail or Outlook mailbox (ADR-0032), read on this device. */
export interface MailboxSource {
  /** New likely job emails; `companies` are the employers on the board. Never throws. */
  pull(companies: readonly string[]): Promise<MailItem[]>;
  /** Marks pulled emails as handled. */
  commit(ids: readonly string[]): Promise<void>;
}

/**
 * Email status updates on this device (Pro; ADR-0014). Pulls the
 * extracted events the Email Worker stored, matches each to a job locally
 * (the jobs never leave this device for this), then:
 *
 *  - confident updates are applied, as one undoable timeline entry;
 *  - less confident ones become a suggestion on the card;
 *  - unmatched ones wait in "Unsorted updates" for one-click assignment.
 *
 * Processed events are deleted from the server, so another device doesn't
 * apply them again. Matched threads (Message-ID → job) and taught senders
 * are remembered here, so later emails in a thread follow.
 *
 * Shared learning (ADR-0014 §6): when the user accepts or corrects a
 * suggestion, or files an unsorted update, this device votes for the email
 * template's meaning and the sender domain's company. Only hashes, domains
 * and labels are sent, and only while "Help improve automatic updates" is on.
 */

const PAGE = 100;
const LOCK_MS = 60_000;
const MAX_THREADS = 500;
const MAX_SENDERS = 200;
const MAX_UNSORTED = 50;
/** A Gmail confirmation code is shown for this long. */
const VERIFICATION_DAYS = 7;

const UnsortedSchema = z.object({
  /** The event's id on the server. */
  id: z.string(),
  receivedAt: z.string(),
  intent: z.enum(EMAIL_UPDATE_INTENTS),
  subject: z.string(),
  sender: z.object({ address: z.string(), name: z.string().optional() }),
  companyHint: z.string().optional(),
  titleHint: z.string().optional(),
  postingUrl: z.string().optional(),
  interview: JobInterviewSchema.optional(),
  messageId: z.string().optional(),
  /** Template fingerprint and sender domain, for shared learning. */
  template: z.string().optional(),
  senderDomain: z.string().optional(),
  /** The server's vote tickets for them (ADR-0028). */
  templateTicket: z.string().optional(),
  domainTicket: z.string().optional(),
  /** Likely jobs, best first. */
  candidates: z.array(z.string()),
});
export type UnsortedUpdate = z.infer<typeof UnsortedSchema>;

const StateSchema = z.object({
  cursor: z.number().default(0),
  threads: z.record(z.string(), z.string()).default({}),
  senders: z.record(z.string(), z.string()).default({}),
  unsorted: z.array(UnsortedSchema).default([]),
  address: z.string().optional(),
  verification: z
    .object({ code: z.string().optional(), url: z.string().optional(), receivedAt: z.string() })
    .optional(),
  lastRunAt: z.string().optional(),
  /** "Help improve automatic updates", as last read from the server. */
  shareLearning: z.boolean().optional(),
  problem: z.enum(['offline', 'signed_out', 'error']).optional(),
  /** When the last forwarded job email arrived (proof that forwarding works). */
  lastEmailAt: z.string().optional(),
  /** Guided setup: the mail service chosen, and the steps the user ticked off. */
  setup: z
    .object({
      provider: z.enum(['gmail', 'outlook', 'manual']).optional(),
      done: z.array(z.string()).default([]),
    })
    .optional(),
});
export type EmailUpdateState = z.infer<typeof StateSchema>;
export type EmailSetup = NonNullable<EmailUpdateState['setup']>;

export interface EmailRun {
  applied: number;
  suggested: number;
  unsorted: number;
  skipped?: 'not_advanced' | 'busy';
}

export interface EmailUpdateAccount {
  currentPlan(): Promise<Plan>;
  /** True during the free trial: trial accounts get updates but don't vote. */
  onTrial(): Promise<boolean>;
}

/** Keeps the newest `max` entries of an insertion-ordered record. */
function capRecord(record: Record<string, string>, max: number): Record<string, string> {
  const entries = Object.entries(record);
  return entries.length <= max ? record : Object.fromEntries(entries.slice(-max));
}

function noteOf(
  intent: EmailNote['intent'],
  email: { subject: string; sender: { address: string; name?: string }; receivedAt: string },
): EmailNote {
  const from = email.sender.name
    ? `${email.sender.name} <${email.sender.address}>`
    : email.sender.address;
  return {
    intent,
    subject: email.subject.slice(0, 500),
    sender: from.slice(0, 400),
    receivedAt: email.receivedAt,
  };
}

/** The card's interview, from an event's (dropping how it was found). */
function interviewOf(interview: EmailEvent['interview']): JobInterview | undefined {
  if (!interview) return undefined;
  const { source: _source, ...rest } = interview;
  return rest.start || rest.meetingUrl || rest.schedulingUrl || rest.location ? rest : undefined;
}

/** A vote needs the server's ticket for the email (ADR-0028); without one, none. */
function templateVote(
  template: string | undefined,
  intent: EmailUpdateIntent | 'other',
  ticket: string | undefined,
): KnowledgeVote[] {
  return template && /^[0-9a-f]{64}$/.test(template) && ticket && VOTE_TICKET.test(ticket)
    ? [{ kind: 'template', key: template, value: intent, ticket }]
    : [];
}

/** Sender domain → company, never for mail platforms or recruiting systems. */
function domainVote(
  domain: string | undefined,
  company: string,
  ticket: string | undefined,
): KnowledgeVote[] {
  const key = domain?.toLowerCase();
  const value = normalizeCompany(company);
  if (!key || !ticket || !VOTE_TICKET.test(ticket)) return [];
  if (isPlatformDomain(key) || !/^[a-z0-9]+( [a-z0-9]+)*$/.test(value)) return [];
  if (value.length < 2 || value.length > 100) return [];
  return [{ kind: 'domain', key, value, ticket }];
}

export class EmailUpdateService {
  constructor(
    private readonly store: KeyValueStore,
    private readonly jobs: JobRepository,
    private readonly settings: SettingsRepository,
    private readonly jobService: JobService,
    private readonly inbox: EmailInbox,
    private readonly account: EmailUpdateAccount,
    private readonly ctx: DomainContext,
    /** A connected mailbox, when this build can connect one (ADR-0032). */
    private readonly mailbox?: MailboxSource,
  ) {}

  async state(): Promise<EmailUpdateState> {
    const raw = (await this.store.get([EMAIL_STATE_KEY]))[EMAIL_STATE_KEY];
    const parsed = StateSchema.safeParse(raw ?? {});
    return parsed.success ? parsed.data : StateSchema.parse({});
  }

  private async save(state: EmailUpdateState): Promise<void> {
    await this.store.set({ [EMAIL_STATE_KEY]: state });
  }

  /** The Gmail confirmation code, while it's fresh. */
  async verification(): Promise<EmailUpdateState['verification']> {
    const { verification } = await this.state();
    if (!verification) return undefined;
    const age = this.ctx.now().getTime() - Date.parse(verification.receivedAt);
    return age < VERIFICATION_DAYS * 86_400_000 ? verification : undefined;
  }

  /** Remembers the guided-setup choice and ticked steps on this device. */
  async setSetup(setup: EmailSetup): Promise<void> {
    const state = await this.state();
    state.setup = {
      ...(setup.provider ? { provider: setup.provider } : {}),
      done: [...new Set(setup.done)],
    };
    await this.save(state);
  }

  /** The forwarding address; `rotate` replaces it (the old one stops working). */
  async address(rotate = false): Promise<InboxInfo> {
    const info = await this.inbox.address(rotate);
    const state = await this.state();
    if (info.ok) {
      state.address = info.address;
      state.shareLearning = info.shareLearning;
    } else delete state.address;
    await this.save(state);
    return info;
  }

  /** Pulls new events and applies, suggests or files each one. */
  async run(): Promise<EmailRun> {
    const none: EmailRun = { applied: 0, suggested: 0, unsorted: 0 };
    if ((await this.account.currentPlan()) !== 'pro') return { ...none, skipped: 'not_advanced' };
    if (!(await this.lock())) return { ...none, skipped: 'busy' };
    const state = await this.state();
    const result = { ...none };
    try {
      for (;;) {
        const rows = await this.inbox.events(state.cursor, PAGE);
        if (rows.length === 0) break;
        for (const row of rows) {
          state.cursor = Math.max(state.cursor, row.id);
          const parsed = EmailEventSchema.safeParse(row.event);
          if (!parsed.success) continue; // never trust shape blindly
          const outcome = await this.process(String(row.id), parsed.data, state);
          if (outcome) result[outcome]++;
        }
        await this.save(state);
        // Processed: remove from the server so other devices don't repeat them.
        await this.inbox.remove(rows.map((r) => r.id));
        if (rows.length < PAGE) break;
      }
      // Then the connected mailbox, read on this device: the same engine and the same steps.
      if (this.mailbox) {
        const companies = [
          ...new Set((await this.jobs.list()).map((j) => j.company).filter(Boolean)),
        ];
        const mail = await this.mailbox.pull(companies);
        for (const item of mail) {
          const outcome = await this.process(item.id, analyzeEmail(item.input), state);
          if (outcome) result[outcome]++;
        }
        await this.save(state);
        await this.mailbox.commit(mail.map((m) => m.id));
      }
      state.lastRunAt = this.ctx.now().toISOString();
      delete state.problem;
      await this.save(state);
      return result;
    } catch (error) {
      state.problem =
        error instanceof BackendError
          ? error.code === 'network'
            ? 'offline'
            : error.code === 'session_expired'
              ? 'signed_out'
              : 'error'
          : 'error';
      await this.save(state);
      throw error;
    } finally {
      await this.unlock();
    }
  }

  private async process(
    id: string,
    event: EmailEvent,
    state: EmailUpdateState,
  ): Promise<keyof Omit<EmailRun, 'skipped'> | undefined> {
    if (event.intent === 'forwarding_verification') {
      state.verification = {
        ...(event.verification?.code ? { code: event.verification.code } : {}),
        ...(event.verification?.url ? { url: event.verification.url } : {}),
        receivedAt: event.receivedAt,
      };
      return undefined;
    }
    // Any forwarded email, even one with nothing to do, shows forwarding works.
    if (!state.lastEmailAt || event.receivedAt > state.lastEmailAt)
      state.lastEmailAt = event.receivedAt;
    if (event.intent === 'other' || event.action === 'none') return undefined;
    const intent = event.intent;

    const [jobs, settings] = await Promise.all([this.jobs.list(), this.settings.get()]);
    const match = matchEvent(event, intent, jobs, settings.stages, state);
    const job = match.jobId ? jobs.find((j) => j.id === match.jobId) : undefined;
    if (!job) {
      state.unsorted = [
        ...state.unsorted.filter((u) => u.id !== id),
        {
          id,
          receivedAt: event.receivedAt,
          intent,
          subject: event.subject,
          sender: {
            address: event.sender.address,
            ...(event.sender.name ? { name: event.sender.name } : {}),
          },
          ...(event.companyHint ? { companyHint: event.companyHint } : {}),
          ...(event.titleHint ? { titleHint: event.titleHint } : {}),
          ...(event.postingUrls[0] ? { postingUrl: event.postingUrls[0] } : {}),
          ...(interviewOf(event.interview) ? { interview: interviewOf(event.interview) } : {}),
          ...(event.thread.messageId ? { messageId: event.thread.messageId } : {}),
          ...(event.template ? { template: event.template } : {}),
          ...(event.sender.domain ? { senderDomain: event.sender.domain } : {}),
          ...(event.tickets?.template ? { templateTicket: event.tickets.template } : {}),
          ...(event.tickets?.domain ? { domainTicket: event.tickets.domain } : {}),
          candidates: match.candidates.map((c) => c.jobId),
        },
      ].slice(-MAX_UNSORTED);
      return 'unsorted';
    }

    this.remember(state, event.thread.messageId, job.id);
    const changed = await this.update(
      job,
      noteOf(intent, event),
      intent === 'interview' ? interviewOf(event.interview) : undefined,
      event.action === 'apply',
      event.template,
      event.tickets?.template,
    );
    return changed ? (event.action === 'apply' ? 'applied' : 'suggested') : undefined;
  }

  /** Applies or suggests an update for `job`. Returns false when nothing would change. */
  private async update(
    job: Job,
    email: EmailNote,
    interview: JobInterview | undefined,
    apply: boolean,
    template?: string,
    templateTicket?: string,
  ): Promise<boolean> {
    const { stages } = await this.settings.get();
    const toStageId = targetStage(email.intent, job, stages);
    if (!toStageId && !interview) return false;
    const update = {
      ...(toStageId ? { toStageId } : {}),
      ...(interview ? { interview } : {}),
      email,
    };
    if (apply) await this.jobService.applyEmailUpdate(job.id, update);
    else
      await this.jobService.suggestEmailUpdate(job.id, {
        ...update,
        ...(template ? { template } : {}),
        ...(template && templateTicket ? { templateTicket } : {}),
      });
    return true;
  }

  private remember(state: EmailUpdateState, messageId: string | undefined, jobId: string): void {
    if (!messageId) return;
    state.threads = capRecord({ ...state.threads, [messageId]: jobId }, MAX_THREADS);
  }

  // ── Unsorted updates ──────────────────────────────────────────────────────

  /**
   * Files an unsorted update under `jobId` and applies it. Also teaches this
   * device that the sender's emails belong to that job, and follows its thread.
   */
  async assign(unsortedId: string, jobId: string): Promise<Job> {
    const state = await this.state();
    const item = state.unsorted.find((u) => u.id === unsortedId);
    const job = await this.jobs.get(jobId);
    if (!item || !job) throw new Error('That update or job no longer exists');
    state.senders = capRecord({ ...state.senders, [item.sender.address]: jobId }, MAX_SENDERS);
    this.remember(state, item.messageId, jobId);
    state.unsorted = state.unsorted.filter((u) => u.id !== unsortedId);
    await this.save(state);
    await this.update(
      job,
      noteOf(item.intent, item),
      item.intent === 'interview' ? item.interview : undefined,
      true,
    );
    await this.vote([
      ...templateVote(item.template, item.intent, item.templateTicket),
      ...domainVote(item.senderDomain, job.company, item.domainTicket),
    ]);
    return (await this.jobs.get(jobId)) ?? job;
  }

  /** "Add this job": creates the job from what the email says, then files the update under it. */
  async addJob(unsortedId: string): Promise<Job> {
    const state = await this.state();
    const item = state.unsorted.find((u) => u.id === unsortedId);
    if (!item) throw new Error('That update no longer exists');
    const settings = await this.settings.get();
    const applied = findStage(settings.stages, 'applied');
    let job: Job;
    try {
      job = await this.jobService.createManual({
        posting: {
          title: item.titleHint ?? (item.subject.slice(0, 300) || 'Untitled job'),
          company: item.companyHint ?? item.sender.name ?? '',
          employmentTypes: [],
        },
        ...(item.postingUrl ? { url: item.postingUrl } : {}),
        // An email about a job means you applied: start it in Applied when that column exists.
        ...(applied && !applied.archived ? { stageId: applied.id } : {}),
      });
    } catch (error) {
      if (!(error instanceof DuplicateJobError)) throw error;
      job = error.existing;
    }
    return this.assign(unsortedId, job.id);
  }

  async dismissUnsorted(unsortedId: string): Promise<void> {
    const state = await this.state();
    state.unsorted = state.unsorted.filter((u) => u.id !== unsortedId);
    await this.save(state);
  }

  // ── Suggestions and shared learning ───────────────────────────────────────

  /** Accepts a suggestion, and confirms its template's meaning for everyone. */
  async acceptSuggestion(jobId: string): Promise<Job> {
    const suggestion = (await this.jobs.get(jobId))?.suggestion;
    const job = await this.jobService.acceptSuggestion(jobId);
    if (suggestion)
      await this.vote(
        templateVote(suggestion.template, suggestion.email.intent, suggestion.templateTicket),
      );
    return job;
  }

  /**
   * "It's something else": applies the intent the user picked instead (or
   * just clears the suggestion for "not an update"), and teaches it.
   */
  async correctSuggestion(jobId: string, intent: EmailUpdateIntent | 'other'): Promise<Job> {
    const job = await this.jobs.get(jobId);
    const suggestion = job?.suggestion;
    if (!job || !suggestion) throw new Error('That suggestion no longer exists');
    let next: Job;
    if (intent === 'other') next = await this.jobService.dismissSuggestion(jobId);
    else {
      const { stages } = await this.settings.get();
      const toStageId = targetStage(intent, job, stages);
      const interview = intent === 'interview' ? suggestion.interview : undefined;
      next = await this.jobService.applyEmailUpdate(jobId, {
        ...(toStageId ? { toStageId } : {}),
        ...(interview ? { interview } : {}),
        email: { ...suggestion.email, intent },
      });
    }
    await this.vote(templateVote(suggestion.template, intent, suggestion.templateTicket));
    return next;
  }

  /** "Help improve automatic updates". Off also withdraws this account's votes. */
  async setSharing(on: boolean): Promise<void> {
    await this.inbox.setSharing(on);
    const state = await this.state();
    state.shareLearning = on;
    await this.save(state);
  }

  /** Best effort: a failed vote never gets in the user's way. */
  private async vote(votes: KnowledgeVote[]): Promise<void> {
    if (votes.length === 0) return;
    if ((await this.state()).shareLearning === false) return;
    if ((await this.account.currentPlan()) !== 'pro') return;
    // The server only counts paying subscribers' votes, so a trial sends none.
    if (await this.account.onTrial()) return;
    try {
      await this.inbox.vote(votes);
    } catch {
      // Shared learning is a bonus; never fail the user's action over it.
    }
  }

  /** A storage lease, so the board and the background worker don't run at the same time. */
  private async lock(): Promise<boolean> {
    const now = this.ctx.now().getTime();
    const held = (await this.store.get([EMAIL_LOCK_KEY]))[EMAIL_LOCK_KEY] as number | undefined;
    if (held !== undefined && held > now) return false;
    await this.store.set({ [EMAIL_LOCK_KEY]: now + LOCK_MS });
    return true;
  }

  private async unlock(): Promise<void> {
    await this.store.remove([EMAIL_LOCK_KEY]);
  }
}
