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
