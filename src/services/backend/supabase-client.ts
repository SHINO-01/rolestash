import { z } from 'zod';
import { ENTITLEMENT_STATUSES } from '@/domain/plan';

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

const EntitlementRow = z.object({
  status: z.enum(ENTITLEMENT_STATUSES),
  trial_ends_at: z.string().nullish(),
  current_period_end: z.string().nullish(),
  provider_customer_id: z.string().nullish(),
});

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
          Authorization: `Bearer ${init.token ?? this.config.anonKey}`,
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

  /** The URL that starts an OAuth sign-in with PKCE. */
  authorizeUrl(provider: 'google', redirectTo: string, codeChallenge: string): string {
    const params = new URLSearchParams({
      provider,
      redirect_to: redirectTo,
      code_challenge: codeChallenge,
      code_challenge_method: 's256',
    });
    return `${this.config.url}/auth/v1/authorize?${params.toString()}`;
  }

  async exchangeCode(authCode: string, codeVerifier: string): Promise<Session> {
    const { status, data } = await this.request('/auth/v1/token?grant_type=pkce', {
      body: { auth_code: authCode, code_verifier: codeVerifier },
    });
    if (status >= 300) this.fail(status, data);
    return this.toSession(data);
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
      '/rest/v1/entitlements?select=status,trial_ends_at,current_period_end,provider_customer_id&limit=1',
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

  async deleteAccount(accessToken: string): Promise<void> {
    const { status, data } = await this.request('/functions/v1/delete-account', {
      body: {},
      token: accessToken,
    });
    if (status === 401) throw new BackendError('session_expired', status);
    if (status >= 300) this.fail(status, data);
  }
}

/** PKCE helpers (RFC 7636, S256). */
export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function createCodeVerifier(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}
