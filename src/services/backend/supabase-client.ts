import { z } from 'zod';
import { AccountProfileSchema, type AccountProfile } from '@/domain/account-profile';
import { ENTITLEMENT_STATUSES, type BillingInterval, type PaidPlan } from '@/domain/plan';

/**
 * A small client for the Supabase endpoints Rolestash uses (ADR-0011):
 * Auth (email code, PKCE exchange, refresh, logout), one PostgREST read and
 * Edge Functions. `fetch` is injected, so this runs under unit tests with a
 * recording fake and never touches the network.
 */

/** Paddle's formatted price for each plan and interval, in one currency. */
export interface LocalPrices {
  currency: string;
  prices: Record<PaidPlan, Record<BillingInterval, string>>;
}

/** Money due now for a plan change, in minor units (cents). */
export interface PlanChangePreview {
  action: 'charge' | 'credit' | 'none';
  amount: number;
  currency: string;
  /** The new plan's regular price, same currency (minor units). */
  recurring?: number;
  /** When it's next billed (ISO). */
  nextBilledAt?: string;
}

export interface BackendConfig {
  /** https://<ref>.supabase.co */
  url: string;
  /** The public anon key (safe to ship; RLS guards the data). */
  anonKey: string;
  /** Google OAuth web client ID (public). Google sign-in is offered only when set. */
  googleClientId?: string;
}

export const SessionSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  /** Epoch milliseconds. */
  expiresAt: z.number(),
  user: z.object({
    id: z.string(),
    email: z.string().optional(),
    /** The full name a provider gave (Google), if any. */
    name: z.string().optional(),
  }),
});
export type Session = z.infer<typeof SessionSchema>;

export interface RemoteEntitlement {
  status: (typeof ENTITLEMENT_STATUSES)[number];
  trialEndsAt?: string;
  currentPeriodEnd?: string;
  /** The server's tier; both mean Pro since ADR-0029. */
  tier: 'pro' | 'advanced';
  /** True once a billing provider knows this customer (portal available). */
  hasBillingAccount: boolean;
  /** Granted by hand, with no subscription (ADR-0025). */
  complimentary: boolean;
}

export type BackendErrorCode =
  | 'network'
  | 'invalid_code'
  | 'rate_limited'
  | 'session_expired'
  | 'already_subscribed'
  | 'no_subscription'
  /** The plan or this device may not sync (lapsed plan, removed device). */
  | 'sync_not_allowed'
  | 'server';

export class BackendError extends Error {
  constructor(
    readonly code: BackendErrorCode,
    readonly status = 0,
  ) {
    super(`Backend error: ${code}${status ? ` (${String(status)})` : ''}`);
    this.name = 'BackendError';
  }
}

const TokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
  user: z.object({
    id: z.string(),
    email: z.string().nullish(),
    user_metadata: z
      .object({ full_name: z.string().nullish(), name: z.string().nullish() })
      .nullish(),
  }),
});

export const DeviceKindSchema = z.enum(['computer', 'web']);

const DeviceRow = z.object({
  id: z.string(),
  name: z.string(),
  kind: DeviceKindSchema,
  created_at: z.string(),
  last_seen_at: z.string(),
});
export interface RemoteDevice {
  id: string;
  name: string;
  kind: z.infer<typeof DeviceKindSchema>;
  createdAt: string;
  lastSeenAt: string;
}

const RegisterResult = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({
    ok: z.literal(false),
    reason: z.enum(['device_limit', 'web_board_advanced', 'plan_required']),
    limit: z.number(),
  }),
]);
export type DeviceRegistration = z.infer<typeof RegisterResult>;

/** One change pushed to the server (ADR-0016). */
export interface SyncChange {
  id: string;
  updatedAt: string;
  deleted?: boolean;
  data?: unknown;
}

const PulledRow = z.object({
  job_id: z.string(),
  data: z.unknown(),
  deleted: z.boolean(),
  updated_at: z.string(),
  revision: z.union([z.number(), z.string()]).transform(Number),
});
export interface PulledChange {
  id: string;
  data: unknown;
  deleted: boolean;
  updatedAt: string;
  revision: number;
}

const EntitlementRow = z.object({
  status: z.enum(ENTITLEMENT_STATUSES),
  trial_ends_at: z.string().nullish(),
  current_period_end: z.string().nullish(),
  provider_customer_id: z.string().nullish(),
  tier: z.enum(['pro', 'advanced']).nullish(),
  complimentary: z.string().nullish(),
});

const InboxResult = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    address: z.email(),
    rotated_at: z.string().nullish(),
    share_learning: z.boolean().optional(),
  }),
  z.object({ ok: z.literal(false), reason: z.literal('plan_required') }),
]);

export type InboxInfo =
  | { ok: true; address: string; rotatedAt?: string; shareLearning: boolean }
  | { ok: false; reason: 'plan_required' };

/** One vote for shared knowledge (ADR-0014 §6). */
export interface KnowledgeVote {
  kind: 'template' | 'domain';
  key: string;
  value: string;
  /** The server's proof that this account received the email (ADR-0028). */
  ticket: string;
}

export interface EmailEventRow {
  id: number;
  /** Validated by the caller with EmailEventSchema. */
  event: unknown;
}

export class SupabaseClient {
  constructor(
    readonly config: BackendConfig,
    private readonly fetchFn: typeof fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async request(
    path: string,
    init: { method?: string; body?: unknown; token?: string; prefer?: string } = {},
  ): Promise<{ status: number; data: unknown }> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.config.url}${path}`, {
        method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
        headers: {
          apikey: this.config.anonKey,
          // Publishable keys (sb_publishable_…) are not JWTs: they go only in
          // `apikey`. Authorization carries a user's access token when there is one.
          ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(init.prefer ? { Prefer: init.prefer } : {}),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
    } catch {
      throw new BackendError('network');
    }
    const text = await response.text();
    let data: unknown;
    try {
      data = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      data = text;
    }
    return { status: response.status, data };
  }

  private toSession(data: unknown): Session {
    const parsed = TokenResponse.safeParse(data);
    if (!parsed.success) throw new BackendError('server');
    const t = parsed.data;
    const name = (t.user.user_metadata?.full_name ?? t.user.user_metadata?.name)?.trim();
    return {
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
      expiresAt: this.now().getTime() + t.expires_in * 1000,
      user: {
        id: t.user.id,
        ...(t.user.email ? { email: t.user.email } : {}),
        ...(name ? { name: name.slice(0, 100) } : {}),
      },
    };
  }

  private fail(status: number, data: unknown): never {
    if (status === 429) throw new BackendError('rate_limited', status);
    const code = (data as { error?: unknown; error_code?: unknown } | null)?.error_code;
    if (code === 'otp_expired' || code === 'invalid_credentials')
      throw new BackendError('invalid_code', status);
    throw new BackendError('server', status);
  }

  /** Which OAuth providers the project has switched on. */
  async oauthProviders(): Promise<{ google: boolean }> {
    const { status, data } = await this.request('/auth/v1/settings');
    if (status >= 300) this.fail(status, data);
    const external = (data as { external?: Record<string, unknown> } | null)?.external;
    return { google: external?.google === true };
  }

  /** Emails a 6-digit sign-in code, creating the account on first use. */
  async sendEmailCode(email: string): Promise<void> {
    const { status, data } = await this.request('/auth/v1/otp', {
      body: { email, create_user: true },
    });
    if (status >= 300) this.fail(status, data);
  }

  async verifyEmailCode(email: string, code: string): Promise<Session> {
    const { status, data } = await this.request('/auth/v1/verify', {
      body: { type: 'email', email, token: code },
    });
    if (status === 401 || status === 403) throw new BackendError('invalid_code', status);
    if (status >= 300) this.fail(status, data);
    return this.toSession(data);
  }

  /**
   * Exchanges a Google ID token for a session (ADR-0012). Supabase verifies the
   * token's signature and audience, and that sha256(nonce) matches its claim.
   */
  async signInWithIdToken(idToken: string, rawNonce: string): Promise<Session> {
    const { status, data } = await this.request('/auth/v1/token?grant_type=id_token', {
      body: { provider: 'google', id_token: idToken, nonce: rawNonce },
    });
    if (status >= 300) this.fail(status, data);
    return this.toSession(data);
  }

  /** Exchanges a single-use sign-in token (from web-handoff) for a session. */
  async verifyTokenHash(tokenHash: string): Promise<Session> {
    const { status, data } = await this.request('/auth/v1/verify', {
      body: { type: 'magiclink', token_hash: tokenHash },
    });
    if (status >= 300) this.fail(status, data);
    return this.toSession(data);
  }

  /** A single-use token that signs the web board in as this user (ADR-0017). */
  async webHandoff(accessToken: string): Promise<string> {
    const { status, data } = await this.request('/functions/v1/web-handoff', {
      body: {},
      token: accessToken,
    });
    if (status === 401) throw new BackendError('session_expired', status);
    const token = (data as { tokenHash?: unknown } | null)?.tokenHash;
    if (status >= 300 || typeof token !== 'string') this.fail(status, data);
    return token;
  }

  async refresh(refreshToken: string): Promise<Session> {
    const { status, data } = await this.request('/auth/v1/token?grant_type=refresh_token', {
      body: { refresh_token: refreshToken },
    });
    if (status === 400 || status === 401 || status === 403)
      throw new BackendError('session_expired', status);
    if (status >= 300) this.fail(status, data);
    return this.toSession(data);
  }

  async signOut(accessToken: string): Promise<void> {
    // Best effort: the local session is cleared regardless.
    await this.request('/auth/v1/logout', { method: 'POST', token: accessToken }).catch(
      () => undefined,
    );
  }

  async entitlement(accessToken: string): Promise<RemoteEntitlement | undefined> {
    const { status, data } = await this.request(
      '/rest/v1/entitlements?select=status,tier,trial_ends_at,current_period_end,provider_customer_id,complimentary&limit=1',
      { token: accessToken },
    );
    if (status === 401) throw new BackendError('session_expired', status);
    if (status >= 300) this.fail(status, data);
    const rows = z.array(EntitlementRow).safeParse(data);
    if (!rows.success) throw new BackendError('server');
    const row = rows.data[0];
    if (!row) return undefined;
    return {
      status: row.status,
      ...(row.trial_ends_at ? { trialEndsAt: new Date(row.trial_ends_at).toISOString() } : {}),
      ...(row.current_period_end
        ? { currentPeriodEnd: new Date(row.current_period_end).toISOString() }
        : {}),
      tier: row.tier ?? 'pro',
      hasBillingAccount: Boolean(row.provider_customer_id),
      complimentary: Boolean(row.complimentary),
    };
  }

  /** Calls an Edge Function that returns `{ url }`. */
  async functionUrl(
    name: 'create-checkout' | 'billing-portal',
    accessToken: string,
    body: unknown = {},
  ): Promise<string> {
    const { status, data } = await this.request(`/functions/v1/${name}`, {
      body,
      token: accessToken,
    });
    const error = (data as { error?: unknown } | null)?.error;
    if (status === 401) throw new BackendError('session_expired', status);
    if (status === 409 && error === 'already_subscribed')
      throw new BackendError('already_subscribed', status);
    if (status === 404 && error === 'no_subscription')
      throw new BackendError('no_subscription', status);
    const url = (data as { url?: unknown } | null)?.url;
    if (status >= 300 || typeof url !== 'string') this.fail(status, data);
    return url;
  }

  /** Moves a live subscription to another plan/interval (prorated by Paddle). */
  /**
   * Plan prices in the caller's own currency, from Paddle (via our prices
   * function, which passes the caller's IP to Paddle and stores nothing).
   */
  async localPrices(): Promise<LocalPrices> {
    const { status, data } = await this.request('/functions/v1/prices');
    if (status >= 300) this.fail(status, data);
    const tier = z.object({ month: z.string(), quarter: z.string(), year: z.string() });
    const parsed = z
      .object({
        currency: z.string(),
        prices: z.object({ pro: tier }),
      })
      .safeParse(data);
    if (!parsed.success) throw new BackendError('server');
    return parsed.data;
  }

  /** What switching plans would charge or credit now (minor units), without switching. */
  async previewPlanChange(
    accessToken: string,
    body: { tier: PaidPlan; interval: BillingInterval },
  ): Promise<PlanChangePreview> {
    const { status, data } = await this.request('/functions/v1/change-plan', {
      body: { ...body, preview: true },
      token: accessToken,
    });
    const error = (data as { error?: unknown } | null)?.error;
    if (status === 401) throw new BackendError('session_expired', status);
    if (status === 404 && error === 'no_subscription')
      throw new BackendError('no_subscription', status);
    if (status >= 300) this.fail(status, data);
    const parsed = z
      .object({
        preview: z.object({
          action: z.enum(['charge', 'credit', 'none']),
          amount: z.number().int().nonnegative(),
          currency: z.string().regex(/^[A-Z]{3}$/),
          recurring: z.number().int().nonnegative().optional(),
          nextBilledAt: z.string().optional(),
        }),
      })
      .safeParse(data);
    if (!parsed.success) throw new BackendError('server');
    return parsed.data.preview;
  }

  async changePlan(accessToken: string, body: { tier: PaidPlan; interval: BillingInterval }) {
    const { status, data } = await this.request('/functions/v1/change-plan', {
      body,
      token: accessToken,
    });
    const error = (data as { error?: unknown } | null)?.error;
    if (status === 401) throw new BackendError('session_expired', status);
    if (status === 404 && error === 'no_subscription')
      throw new BackendError('no_subscription', status);
    if (status >= 300) this.fail(status, data);
  }

  /** Sync RPCs: maps auth and permission failures to typed errors. */
  private async rpc(name: string, accessToken: string, body: unknown): Promise<unknown> {
    const { status, data } = await this.request(`/rest/v1/rpc/${name}`, {
      body,
      token: accessToken,
    });
    if (status === 401) throw new BackendError('session_expired', status);
    if (status === 403) throw new BackendError('sync_not_allowed', status);
    if (status >= 300) this.fail(status, data);
    return data;
  }

  async registerDevice(
    accessToken: string,
    device: { id: string; name: string; kind: RemoteDevice['kind'] },
  ): Promise<DeviceRegistration> {
    const data = await this.rpc('register_device', accessToken, {
      p_id: device.id,
      p_name: device.name,
      p_kind: device.kind,
    });
    const parsed = RegisterResult.safeParse(data);
    if (!parsed.success) throw new BackendError('server');
    return parsed.data;
  }

  async listDevices(accessToken: string): Promise<RemoteDevice[]> {
    const { status, data } = await this.request(
      '/rest/v1/devices?select=id,name,kind,created_at,last_seen_at&order=last_seen_at.desc',
      { token: accessToken },
    );
    if (status === 401) throw new BackendError('session_expired', status);
    if (status >= 300) this.fail(status, data);
    const rows = z.array(DeviceRow).safeParse(data);
    if (!rows.success) throw new BackendError('server');
    return rows.data.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      createdAt: new Date(r.created_at).toISOString(),
      lastSeenAt: new Date(r.last_seen_at).toISOString(),
    }));
  }

  async removeDevice(accessToken: string, id: string): Promise<void> {
    const { status, data } = await this.request(
      `/rest/v1/devices?id=eq.${encodeURIComponent(id)}`,
      { method: 'DELETE', token: accessToken },
    );
    if (status === 401) throw new BackendError('session_expired', status);
    if (status >= 300) this.fail(status, data);
  }

  /** Returns how many changes the server applied (older ones lose). */
  async pushJobs(accessToken: string, deviceId: string, changes: SyncChange[]): Promise<number> {
    const data = await this.rpc('push_jobs', accessToken, {
      p_device: deviceId,
      p_changes: changes,
    });
    return typeof data === 'number' ? data : 0;
  }

  async pullJobs(
    accessToken: string,
    deviceId: string,
    after: number,
    limit: number,
  ): Promise<PulledChange[]> {
    const data = await this.rpc('pull_jobs', accessToken, {
      p_device: deviceId,
      p_after: after,
      p_limit: limit,
    });
    const rows = z.array(PulledRow).safeParse(data);
    if (!rows.success) throw new BackendError('server');
    return rows.data.map((r) => ({
      id: r.job_id,
      data: r.data,
      deleted: r.deleted,
      updatedAt: new Date(r.updated_at).toISOString(),
      revision: r.revision,
    }));
  }

  // ── Email updates (ADR-0014) ─────────────────────────────────────────────

  /** The forwarding address (Pro), created on first call; or why there isn't one. */
  async myInbox(accessToken: string, rotate = false): Promise<InboxInfo> {
    const data = await this.rpc(rotate ? 'rotate_inbox' : 'my_inbox', accessToken, {});
    const parsed = InboxResult.safeParse(data);
    if (!parsed.success) throw new BackendError('server');
    return parsed.data.ok
      ? {
          ok: true,
          address: parsed.data.address,
          ...(parsed.data.rotated_at
            ? { rotatedAt: new Date(parsed.data.rotated_at).toISOString() }
            : {}),
          shareLearning: parsed.data.share_learning ?? true,
        }
      : { ok: false, reason: parsed.data.reason };
  }

  /** Votes for shared knowledge; the server checks the plan, the switch and limits. */
  async voteEmailKnowledge(accessToken: string, votes: readonly KnowledgeVote[]): Promise<void> {
    if (votes.length === 0) return;
    await this.rpc('vote_email_knowledge', accessToken, { p_votes: votes });
  }

  /** "Help improve automatic updates"; turning it off also withdraws your votes. */
  async setEmailSharing(accessToken: string, on: boolean): Promise<void> {
    await this.rpc('set_email_sharing', accessToken, { p_on: on });
  }

  // ── Account profile (ADR-0022) ──────────────────────────────────────────

  /** The caller's display name and picture; empty when never set. */
  async accountProfile(accessToken: string): Promise<AccountProfile> {
    const { status, data } = await this.request(
      '/rest/v1/account_profiles?select=display_name,avatar',
      { token: accessToken },
    );
    if (status === 401) throw new BackendError('session_expired', status);
    if (status >= 300) this.fail(status, data);
    const row = z
      .array(z.object({ display_name: z.string().nullish(), avatar: z.string().nullish() }))
      .safeParse(data);
    if (!row.success) throw new BackendError('server');
    const first = row.data[0];
    const profile = AccountProfileSchema.safeParse({
      ...(first?.display_name ? { displayName: first.display_name } : {}),
      ...(first?.avatar ? { avatar: first.avatar } : {}),
    });
    return profile.success ? profile.data : {};
  }

  /** Saves the display name and picture (missing fields are cleared). */
  async saveAccountProfile(
    accessToken: string,
    userId: string,
    profile: AccountProfile,
  ): Promise<void> {
    const { status, data } = await this.request('/rest/v1/account_profiles?on_conflict=user_id', {
      body: {
        user_id: userId,
        display_name: profile.displayName ?? null,
        avatar: profile.avatar ?? null,
        updated_at: this.now().toISOString(),
      },
      token: accessToken,
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
    if (status === 401) throw new BackendError('session_expired', status);
    if (status >= 300) this.fail(status, data);
  }

  /** Extracted email events after `after` (by id), oldest first. */
  async emailEvents(accessToken: string, after: number, limit: number): Promise<EmailEventRow[]> {
    const { status, data } = await this.request(
      `/rest/v1/email_events?select=id,event&id=gt.${String(after)}&order=id.asc&limit=${String(limit)}`,
      { token: accessToken },
    );
    if (status === 401) throw new BackendError('session_expired', status);
    if (status >= 300) this.fail(status, data);
    const rows = z.array(z.object({ id: z.number().int(), event: z.unknown() })).safeParse(data);
    if (!rows.success) throw new BackendError('server');
    return rows.data;
  }

  /** Deletes processed events, so other devices don't apply them twice. */
  async deleteEmailEvents(accessToken: string, ids: readonly number[]): Promise<void> {
    if (ids.length === 0) return;
    const { status, data } = await this.request(
      `/rest/v1/email_events?id=in.(${ids.map((id) => String(Math.trunc(id))).join(',')})`,
      { method: 'DELETE', token: accessToken },
    );
    if (status === 401) throw new BackendError('session_expired', status);
    if (status >= 300) this.fail(status, data);
  }

  /** Asks for the welcome email; the server sends it once per account (ADR-0024). */
  async sendWelcome(accessToken: string): Promise<boolean> {
    const { status, data } = await this.request('/functions/v1/welcome', {
      body: {},
      token: accessToken,
    });
    if (status === 401) throw new BackendError('session_expired', status);
    if (status >= 300) this.fail(status, data);
    return (data as { sent?: unknown } | null)?.sent === true;
  }

  /**
   * Sends a bug report (ADR-0024). Works signed out; when signed in, the
   * account is attached so support can see the plan. Returns the report id.
   */
  async reportBug(
    report: { message: string; contactEmail?: string; context: Record<string, string> },
    accessToken?: string,
  ): Promise<number> {
    const { status, data } = await this.request('/functions/v1/bug-report', {
      body: report,
      ...(accessToken ? { token: accessToken } : {}),
    });
    if (status >= 300) this.fail(status, data);
    const id = (data as { id?: unknown } | null)?.id;
    if (typeof id !== 'number') throw new BackendError('server');
    return id;
  }

  async deleteAccount(accessToken: string): Promise<void> {
    const { status, data } = await this.request('/functions/v1/delete-account', {
      body: {},
      token: accessToken,
    });
    if (status === 401) throw new BackendError('session_expired', status);
    if (status >= 300) this.fail(status, data);
  }
}

/** URL-safe base64 without padding. */
export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 256 bits of randomness, URL-safe (nonces and state values). */
export function randomToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}
