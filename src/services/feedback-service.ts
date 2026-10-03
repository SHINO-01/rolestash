import {
  answerRating,
  INITIAL_RATING_STATE,
  shouldAskForRating,
  type RatingPromptState,
  type ReportContext,
} from '@/domain/feedback';
import type { DomainContext } from '@/domain/job-factory';
import type { JobRepository } from '@/storage/job-repository';
import type { KeyValueStore } from '@/storage/key-value-store';
import { RATING_PROMPT_KEY } from '@/storage/keys';
import type { AccountService } from './account-service';
import type { SupabaseClient } from './backend/supabase-client';

/** What the platform knows about this install, for bug reports. */
export interface AboutThisCopy {
  version: string;
  browser: string;
}

/**
 * The store-rating prompt and "Report a problem" (ADR-0024). Ratings are
 * asked for on this device only; reports go to our own backend, or, in
 * builds without one, to a prefilled email.
 */
export class FeedbackService {
  constructor(
    private readonly store: KeyValueStore,
    private readonly jobs: JobRepository,
    private readonly ctx: DomainContext,
    private readonly about: AboutThisCopy,
    private readonly client?: SupabaseClient,
    private readonly account?: AccountService,
  ) {}

  private async ratingState(): Promise<RatingPromptState> {
    const raw = (await this.store.get([RATING_PROMPT_KEY]))[RATING_PROMPT_KEY] as
      RatingPromptState | undefined;
    return { ...INITIAL_RATING_STATE, ...raw };
  }

  /** Call when the board opens: remembers the first visit, then says whether to ask. */
  async shouldAskForRating(): Promise<boolean> {
    let state = await this.ratingState();
    if (!state.firstSeenAt) {
      state = { ...state, firstSeenAt: this.ctx.now().toISOString() };
      await this.store.set({ [RATING_PROMPT_KEY]: state });
    }
    return shouldAskForRating(state, (await this.jobs.list()).length, this.ctx.now());
  }

  async answerRating(answer: 'rate' | 'later' | 'never'): Promise<void> {
    const next = answerRating(await this.ratingState(), answer, this.ctx.now());
    await this.store.set({ [RATING_PROMPT_KEY]: next });
  }

  /** Whether reports go to our backend (true) or need the email fallback (false). */
  get canSendReports(): boolean {
    return this.client !== undefined;
  }

  /** The details a report carries, for showing before it's sent. */
  async reportContext(where: ReportContext['where'], page?: string): Promise<ReportContext> {
    const plan = this.account ? (await this.account.state()).plan.plan : 'free';
    return {
      version: this.about.version,
      browser: this.about.browser,
      plan,
      where,
      ...(page ? { page } : {}),
    };
  }

  /** Sends a report and returns its number. Signed-in reports carry the account. */
  async report(input: {
    message: string;
    contactEmail?: string;
    context: ReportContext;
  }): Promise<number> {
    if (!this.client) throw new Error('Reports need the backend; use the email link instead.');
    const state = this.account ? await this.account.state() : undefined;
    const token = state?.signedIn ? await this.account?.token().catch(() => undefined) : undefined;
    const context: Record<string, string> = { ...input.context };
    return this.client.reportBug(
      {
        message: input.message.trim(),
        ...(input.contactEmail?.trim() ? { contactEmail: input.contactEmail.trim() } : {}),
        context,
      },
      token,
    );
  }
}
