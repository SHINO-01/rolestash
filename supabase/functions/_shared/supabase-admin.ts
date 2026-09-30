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
