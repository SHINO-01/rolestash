import { z } from 'zod';
import type { DomainContext } from '@/domain/job-factory';
import { likelyJobEmail, type EmailInput } from '@/email/mailbox';
import type { KeyValueStore } from '@/storage/key-value-store';
import { MAILBOX_AUTH_KEY, MAILBOX_STATE_KEY } from '@/storage/keys';
import { GmailClient, gmailAuthUrl, readGmailRedirect } from './mail/gmail';
import { OutlookClient, outlookAuthUrl, outlookToken, readOutlookRedirect } from './mail/outlook';
import {
  MAIL_PROVIDERS,
  MailAuthError,
  MailUnavailableError,
  pkceChallenge,
  randomToken,
  type MailClient,
  type MailProvider,
  type MailTokens,
} from './mail/types';
import type { WebAuthFlow } from './ports';

/**
 * A connected Gmail or Outlook mailbox (Pro; ADR-0032). Read-only, and read
 * on this device: new inbox mail is listed, a first look at the sender and
 * subject picks likely job emails, and only those are downloaded and handed
 * to the email engine. Nothing from the mailbox is sent to Rolestash's
 * servers; only the resulting job updates sync, like any other edit.
 *
 * Runs whenever email updates run: at browser startup, every few minutes,
 * and when a board opens or regains focus.
 */

export interface MailConfig {
  googleClientId?: string;
  microsoftClientId?: string;
}

/** How far back a newly connected mailbox is read. */
const BACKFILL_DAYS = 14;
/** Re-list a little before the last message seen, in case of clock skew. */
const OVERLAP_MS = 10 * 60_000;
/** Messages listed, and downloaded in full, per check. */
const LIST_LIMIT = 50;
const READ_LIMIT = 30;
const SEEN_LIMIT = 1000;
/** Renew a token this long before it runs out. */
const RENEW_EARLY_MS = 60_000;

const StateSchema = z.object({
  provider: z.enum(MAIL_PROVIDERS),
  address: z.string(),
  connectedAt: z.string(),
  /** Messages received after this were not yet seen. */
  since: z.string(),
  /** Provider message ids already handled, newest last. */
  seen: z.array(z.string()).default([]),
  lastCheckedAt: z.string().optional(),
  /** `reconnect`: access ran out (the user must connect again). */
  problem: z.enum(['reconnect', 'offline']).optional(),
});
export type MailboxState = z.infer<typeof StateSchema>;

const TokensSchema = z.object({
  accessToken: z.string(),
  expiresAt: z.number(),
  refreshToken: z.string().optional(),
});

export interface MailItem {
  /** `<provider>:<message id>`, unique across mailboxes. */
  id: string;
  input: EmailInput;
}

export class MailboxService {
  private readonly clients: Record<MailProvider, MailClient>;

  constructor(
    private readonly store: KeyValueStore,
    private readonly authFlow: WebAuthFlow,
    private readonly fetcher: typeof fetch,
    private readonly config: MailConfig,
    private readonly ctx: DomainContext,
  ) {
    this.clients = { gmail: new GmailClient(fetcher), outlook: new OutlookClient(fetcher) };
  }

  /** The providers this build can connect (each needs its OAuth client ID). */
  providers(): MailProvider[] {
    return [
      ...(this.config.googleClientId ? (['gmail'] as const) : []),
      ...(this.config.microsoftClientId ? (['outlook'] as const) : []),
    ];
  }

  async state(): Promise<MailboxState | undefined> {
    const stored = await this.store.get([MAILBOX_STATE_KEY]);
    const parsed = StateSchema.safeParse(stored[MAILBOX_STATE_KEY]);
    return parsed.success ? parsed.data : undefined;
  }

  /** Signs in to the provider (a window the user sees) and starts reading from two weeks ago. */
  async connect(provider: MailProvider): Promise<MailboxState> {
    const tokens = await this.signIn(provider);
    const address = await this.clients[provider].address(tokens.accessToken);
    const previous = await this.state();
    const now = this.ctx.now();
    const state: MailboxState = {
      provider,
      address,
      connectedAt: now.toISOString(),
      since:
        previous?.provider === provider && previous.address === address
          ? previous.since
          : new Date(now.getTime() - BACKFILL_DAYS * 86_400_000).toISOString(),
      seen: previous?.provider === provider ? previous.seen : [],
    };
    await this.store.set({ [MAILBOX_STATE_KEY]: state, [MAILBOX_AUTH_KEY]: tokens });
    return state;
  }

  /** Forgets the mailbox and its tokens on this device (and revokes Google's token). */
  async disconnect(): Promise<void> {
    const [state, tokens] = await Promise.all([this.state(), this.tokens()]);
    await this.store.remove([MAILBOX_STATE_KEY, MAILBOX_AUTH_KEY]);
    if (state?.provider === 'gmail' && tokens)
      await this.fetcher(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokens.accessToken)}`,
        { method: 'POST' },
      ).catch(() => undefined);
  }

  /**
   * New likely job emails since the last check, oldest first. Never throws:
   * a mailbox that can't be read is noted in its state for the UI.
   */
  async pull(companies: readonly string[]): Promise<MailItem[]> {
    const state = await this.state();
    if (!state) return [];
    const client = this.clients[state.provider];
    const now = this.ctx.now();
    try {
      const token = await this.accessToken(state);
      const since = new Date(Date.parse(state.since) - OVERLAP_MS);
      const listed = await client.list(token, since, LIST_LIMIT, companies);
      const seen = new Set(state.seen);
      const fresh = listed.filter((m) => !seen.has(m.id));
      const likely = fresh.filter((m) => likelyJobEmail(m.look, companies));
      const wanted = likely.slice(0, READ_LIMIT);
      const items: MailItem[] = [];
      for (const message of wanted) {
        const input = await client.read(token, message.id);
        if (input) items.push({ id: `${state.provider}:${message.id}`, input });
      }
      // Mail that isn't about a job is done with now; job mail once it's applied (commit).
      const skipped = fresh.filter((m) => !likely.includes(m)).map((m) => m.id);
      // Move the cursor past every message handled in order (seen, skipped or read now);
      // the first one left for later (over READ_LIMIT) stops it, so nothing is missed.
      const handled = new Set([...state.seen, ...skipped, ...wanted.map((m) => m.id)]);
      let cursor = state.since;
      for (const message of listed) {
        if (!handled.has(message.id)) break;
        if (message.receivedAt > cursor) cursor = message.receivedAt;
      }
      await this.save({
        ...state,
        since: cursor,
        seen: [...state.seen, ...skipped].slice(-SEEN_LIMIT),
        lastCheckedAt: now.toISOString(),
        problem: undefined,
      });
      return items;
    } catch (error) {
      await this.save({
        ...state,
        lastCheckedAt: now.toISOString(),
        problem: error instanceof MailAuthError ? 'reconnect' : 'offline',
      });
      if (!(error instanceof MailAuthError) && !(error instanceof MailUnavailableError))
        console.error('[rolestash] mailbox check failed', error);
      return [];
    }
  }

  /** Marks pulled messages as handled, so they're never read again. */
  async commit(ids: readonly string[]): Promise<void> {
    const state = await this.state();
    if (!state || ids.length === 0) return;
    const prefix = `${state.provider}:`;
    const own = ids.filter((id) => id.startsWith(prefix)).map((id) => id.slice(prefix.length));
    await this.save({ ...state, seen: [...state.seen, ...own].slice(-SEEN_LIMIT) });
  }

  private async save(
    state: Omit<MailboxState, 'problem'> & { problem?: MailboxState['problem'] | undefined },
  ): Promise<void> {
    const { problem, ...rest } = state;
    // A successful check clears an old problem; a failed one sets it.
    await this.store.set({ [MAILBOX_STATE_KEY]: problem ? { ...rest, problem } : rest });
  }

  private async tokens(): Promise<MailTokens | undefined> {
    const stored = await this.store.get([MAILBOX_AUTH_KEY]);
    const parsed = TokensSchema.safeParse(stored[MAILBOX_AUTH_KEY]);
    return parsed.success ? parsed.data : undefined;
  }

  /** A live access token: the stored one, or a renewed one. */
  private async accessToken(state: MailboxState): Promise<string> {
    const tokens = await this.tokens();
    const now = this.ctx.now().getTime();
    if (tokens && tokens.expiresAt - RENEW_EARLY_MS > now) return tokens.accessToken;
    const renewed = await this.renew(state, tokens);
    await this.store.set({ [MAILBOX_AUTH_KEY]: renewed });
    return renewed.accessToken;
  }

  private async renew(state: MailboxState, tokens: MailTokens | undefined): Promise<MailTokens> {
    const redirectUri = this.authFlow.redirectUrl();
    const now = this.ctx.now().getTime();
    if (state.provider === 'outlook') {
      const clientId = this.config.microsoftClientId;
      if (!clientId || !tokens?.refreshToken) throw new MailAuthError();
      const next = await outlookToken(this.fetcher, {
        clientId,
        redirectUri,
        now,
        refreshToken: tokens.refreshToken,
      });
      return { ...next, refreshToken: next.refreshToken ?? tokens.refreshToken };
    }
    const clientId = this.config.googleClientId;
    if (!clientId || !this.authFlow.launchSilently) throw new MailAuthError();
    const stateValue = randomToken();
    const result = await this.authFlow.launchSilently(
      gmailAuthUrl({
        clientId,
        redirectUri,
        state: stateValue,
        silent: true,
        loginHint: state.address,
      }),
    );
    if (!result) throw new MailAuthError();
    return readGmailRedirect(result, stateValue, now);
  }

  private async signIn(provider: MailProvider): Promise<MailTokens> {
    const redirectUri = this.authFlow.redirectUrl();
    const state = randomToken();
    const now = () => this.ctx.now().getTime();
    if (provider === 'gmail') {
      const clientId = this.config.googleClientId;
      if (!clientId) throw new MailAuthError('Gmail is not available in this build');
      const result = await this.authFlow.launch(gmailAuthUrl({ clientId, redirectUri, state }));
      return readGmailRedirect(result, state, now());
    }
    const clientId = this.config.microsoftClientId;
    if (!clientId) throw new MailAuthError('Outlook is not available in this build');
    const verifier = randomToken(48);
    const result = await this.authFlow.launch(
      outlookAuthUrl({ clientId, redirectUri, state, challenge: await pkceChallenge(verifier) }),
    );
    const code = readOutlookRedirect(result, state);
    return outlookToken(this.fetcher, { clientId, redirectUri, now: now(), code, verifier });
  }
}
