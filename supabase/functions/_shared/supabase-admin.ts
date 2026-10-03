import type { BillingEvent, EntitlementStatus } from './paddle.ts';

/**
 * Server-side Supabase calls made by Edge Functions. Uses the service role
 * key, which exists only in Edge Function secrets, never in clients.
 */

export interface SupabaseAdminConfig {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

export interface AuthUser {
  id: string;
  email: string | null;
}

export interface EntitlementRow {
  status: EntitlementStatus;
  provider: string | null;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  current_period_end: string | null;
}

export interface ProfileRow {
  display_name: string | null;
  welcome_sent_at: string | null;
}

export interface BugReportRow {
  user_id: string | null;
  contact_email: string | null;
  message: string;
  context: Record<string, unknown>;
  ip_hash: string | null;
}

export class SupabaseAdmin {
  constructor(
    private readonly config: SupabaseAdminConfig,
    private readonly fetchFn: typeof fetch,
  ) {}

  private serviceHeaders(): Record<string, string> {
    return {
      apikey: this.config.serviceRoleKey,
      Authorization: `Bearer ${this.config.serviceRoleKey}`,
      'Content-Type': 'application/json',
    };
  }

  /** Resolves a user's access token to the user, or null if it's invalid or expired. */
  async userFromToken(accessToken: string): Promise<AuthUser | null> {
    const response = await this.fetchFn(`${this.config.url}/auth/v1/user`, {
      headers: { apikey: this.config.anonKey, Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const user = (await response.json()) as { id?: unknown; email?: unknown };
    return typeof user.id === 'string'
      ? { id: user.id, email: typeof user.email === 'string' ? user.email : null }
      : null;
  }

  /** The account's name and welcome-email state, or null with no profile row. */
  async profile(userId: string): Promise<ProfileRow | null> {
    const response = await this.fetchFn(
      `${this.config.url}/rest/v1/account_profiles?user_id=eq.${encodeURIComponent(userId)}` +
        '&select=display_name,welcome_sent_at',
      { headers: this.serviceHeaders() },
    );
    if (!response.ok) throw new Error(`profile lookup failed: ${response.status}`);
    return ((await response.json()) as ProfileRow[])[0] ?? null;
  }

  /**
   * Marks the welcome email as sent, once: true only for the call that set
   * it, so two devices signing in together can't both send it.
   */
  async claimWelcome(userId: string, at: Date): Promise<boolean> {
    const base = `${this.config.url}/rest/v1/account_profiles`;
    const ensure = await this.fetchFn(`${base}?on_conflict=user_id`, {
      method: 'POST',
      headers: { ...this.serviceHeaders(), Prefer: 'resolution=ignore-duplicates' },
      body: JSON.stringify({ user_id: userId }),
    });
    if (!ensure.ok) throw new Error(`profile create failed: ${ensure.status}`);
    const claim = await this.fetchFn(
      `${base}?user_id=eq.${encodeURIComponent(userId)}&welcome_sent_at=is.null`,
      {
        method: 'PATCH',
        headers: { ...this.serviceHeaders(), Prefer: 'return=representation' },
        body: JSON.stringify({ welcome_sent_at: at.toISOString() }),
      },
    );
    if (!claim.ok) throw new Error(`welcome claim failed: ${claim.status}`);
    return ((await claim.json()) as unknown[]).length === 1;
  }

  /** Undoes a claim when the email couldn't be sent, so the next sign-in retries. */
  async releaseWelcome(userId: string): Promise<void> {
    await this.fetchFn(
      `${this.config.url}/rest/v1/account_profiles?user_id=eq.${encodeURIComponent(userId)}`,
      {
        method: 'PATCH',
        headers: this.serviceHeaders(),
        body: JSON.stringify({ welcome_sent_at: null }),
      },
    );
  }

  /** How many reports came from this (hashed) address since `since`. */
  async bugReportsSince(ipHash: string, since: Date): Promise<number> {
    const response = await this.fetchFn(
      `${this.config.url}/rest/v1/bug_reports?ip_hash=eq.${ipHash}` +
        `&created_at=gte.${encodeURIComponent(since.toISOString())}&select=id`,
      { headers: { ...this.serviceHeaders(), Prefer: 'count=exact', Range: '0-0' } },
    );
    if (!response.ok) throw new Error(`report count failed: ${response.status}`);
    const total = /\/(\d+)$/.exec(response.headers.get('Content-Range') ?? '')?.[1];
    return total ? Number(total) : 0;
  }

  /** Stores a report and returns its id; reports past 12 months are deleted. */
  async insertBugReport(row: BugReportRow, now: Date): Promise<number> {
    const base = `${this.config.url}/rest/v1/bug_reports`;
    const response = await this.fetchFn(base, {
      method: 'POST',
      headers: { ...this.serviceHeaders(), Prefer: 'return=representation' },
      body: JSON.stringify(row),
    });
    if (!response.ok) throw new Error(`report insert failed: ${response.status}`);
    const [created] = (await response.json()) as { id: number }[];
    const yearAgo = new Date(now.getTime() - 365 * 24 * 3600_000).toISOString();
    await this.fetchFn(`${base}?created_at=lt.${encodeURIComponent(yearAgo)}`, {
      method: 'DELETE',
      headers: this.serviceHeaders(),
    }).catch(() => undefined);
    if (!created) throw new Error('report insert returned nothing');
    return created.id;
  }

  async entitlement(userId: string): Promise<EntitlementRow | null> {
    const response = await this.fetchFn(
      `${this.config.url}/rest/v1/entitlements?user_id=eq.${encodeURIComponent(userId)}` +
        '&select=status,provider,provider_customer_id,provider_subscription_id,current_period_end',
      { headers: this.serviceHeaders() },
    );
    if (!response.ok) throw new Error(`entitlement lookup failed: ${response.status}`);
    const rows = (await response.json()) as EntitlementRow[];
    return rows[0] ?? null;
  }

  /** The account already billed as this Paddle customer, if any. */
  async userIdForCustomer(customerId: string): Promise<string | null> {
    const response = await this.fetchFn(
      `${this.config.url}/rest/v1/entitlements?provider_customer_id=eq.${encodeURIComponent(customerId)}&select=user_id&limit=1`,
      { headers: this.serviceHeaders() },
    );
    if (!response.ok) throw new Error(`customer lookup failed: ${response.status}`);
    const rows = (await response.json()) as { user_id?: unknown }[];
    return typeof rows[0]?.user_id === 'string' ? rows[0].user_id : null;
  }

  /** The account for an email (service role only; public.user_id_for_email). */
  async userIdForEmail(email: string): Promise<string | null> {
    const response = await this.fetchFn(`${this.config.url}/rest/v1/rpc/user_id_for_email`, {
      method: 'POST',
      headers: this.serviceHeaders(),
      body: JSON.stringify({ p_email: email }),
    });
    if (!response.ok) throw new Error(`email lookup failed: ${response.status}`);
    const id = (await response.json()) as unknown;
    return typeof id === 'string' ? id : null;
  }

  /**
   * Creates an account for someone who bought on the website before signing
   * up. They sign in later with this email (code or Google); no email is sent.
   */
  async createUser(email: string): Promise<string> {
    const response = await this.fetchFn(`${this.config.url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: this.serviceHeaders(),
      body: JSON.stringify({ email, email_confirm: true }),
    });
    if (!response.ok) throw new Error(`create user failed: ${response.status}`);
    const user = (await response.json()) as { id?: unknown };
    if (typeof user.id !== 'string') throw new Error('create user returned no id');
    return user.id;
  }

  /** True when applied; false when stale, duplicate or for an unknown user. */
  async applyBillingEvent(event: BillingEvent, provider: 'paddle'): Promise<boolean> {
    const response = await this.fetchFn(`${this.config.url}/rest/v1/rpc/apply_billing_event`, {
      method: 'POST',
      headers: this.serviceHeaders(),
      body: JSON.stringify({
        p_user_id: event.userId,
        p_occurred_at: event.occurredAt,
        p_status: event.status,
        p_current_period_end: event.currentPeriodEnd,
        p_billing_interval: event.billingInterval,
        p_provider: provider,
        p_customer_id: event.customerId,
        p_subscription_id: event.subscriptionId,
        p_tier: event.tier,
      }),
    });
    if (!response.ok) throw new Error(`apply_billing_event failed: ${response.status}`);
    return (await response.json()) === true;
  }

  /**
   * A single-use sign-in token for this user (no email is sent): the
   * extension hands it to the web board, which exchanges it for its own
   * session (ADR-0017). Expires with the project's OTP expiry (10 minutes).
   */
  async signInTokenFor(email: string): Promise<string> {
    const response = await this.fetchFn(`${this.config.url}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: this.serviceHeaders(),
      body: JSON.stringify({ type: 'magiclink', email }),
    });
    if (!response.ok) throw new Error(`generate_link failed: ${response.status}`);
    const data = (await response.json()) as {
      hashed_token?: unknown;
      properties?: { hashed_token?: unknown };
    };
    const token = data.properties?.hashed_token ?? data.hashed_token;
    if (typeof token !== 'string' || !token) throw new Error('generate_link returned no token');
    return token;
  }

  /** Deletes the auth user; entitlements cascade (trial_claims stay, by design). */
  async deleteUser(userId: string): Promise<void> {
    const response = await this.fetchFn(
      `${this.config.url}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
      { method: 'DELETE', headers: this.serviceHeaders() },
    );
    if (!response.ok && response.status !== 404) {
      throw new Error(`delete user failed: ${response.status}`);
    }
  }
}
