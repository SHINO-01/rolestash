import { z } from 'zod';
import { ENTITLEMENT_STATUSES, type PaidPlan } from '@/domain/plan';

/**
 * A small client for the Supabase endpoints Rolestash uses (ADR-0011):
 * Auth (email code, PKCE exchange, refresh, logout), one PostgREST read and
 * Edge Functions. `fetch` is injected, so this runs under unit tests with a
 * recording fake and never touches the network.
 */

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
  user: z.object({ id: z.string(), email: z.string().optional() }),
});
export type Session = z.infer<typeof SessionSchema>;

export interface RemoteEntitlement {
  status: (typeof ENTITLEMENT_STATUSES)[number];
  trialEndsAt?: string;
  currentPeriodEnd?: string;
  /** Plan of the trial or subscription (trials are Pro). */
  tier: PaidPlan;
  /** True once a billing provider knows this customer (portal available). */
  hasBillingAccount: boolean;
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
  user: z.object({ id: z.string(), email: z.string().nullish() }),
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
    init: { method?: string; body?: unknown; token?: string } = {},
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
    return {
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
      expiresAt: this.now().getTime() + t.expires_in * 1000,
      user: { id: t.user.id, ...(t.user.email ? { email: t.user.email } : {}) },
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
      '/rest/v1/entitlements?select=status,tier,trial_ends_at,current_period_end,provider_customer_id&limit=1',
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
  async changePlan(accessToken: string, body: { tier: PaidPlan; interval: 'month' | 'year' }) {
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

  /** The forwarding address (Advanced), created on first call; or why there isn't one. */
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
