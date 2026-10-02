/**
 * Paddle Billing: webhook verification, event → entitlement mapping, and the
 * few API calls we make. Pure TypeScript with injected fetch, so the same
 * code runs in Supabase Edge Functions (Deno) and in Vitest.
 */

export type PaidTier = 'pro' | 'advanced';
export type BillingInterval = 'month' | 'year';

export type EntitlementStatus =
  'trialing' | 'active' | 'past_due' | 'paused' | 'canceled' | 'expired';

/**
 * A webhook's event before we know whose it is: purchases made on
 * rolestash.com/pricing/ carry no user id (the extension's checkouts do).
 */
export type IncomingBillingEvent = Omit<BillingEvent, 'userId'> & { userId: string | null };

/** What apply_billing_event() needs (supabase/migrations). */
export interface BillingEvent {
  userId: string;
  occurredAt: string;
  status: EntitlementStatus;
  currentPeriodEnd: string | null;
  billingInterval: 'month' | 'year' | null;
  customerId: string | null;
  subscriptionId: string;
  tier: PaidTier;
}

/** Replay window for signed webhooks. Paddle's SDK uses 5 s; we allow clock skew. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verifies a `Paddle-Signature: ts=…;h1=…[;h1=…]` header against the raw body.
 * Any h1 may match (Paddle sends several while a secret is being rotated).
 */
export async function verifyPaddleSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  now: Date,
): Promise<boolean> {
  if (!header || !secret) return false;
  let ts: string | undefined;
  const signatures: string[] = [];
  for (const part of header.split(';')) {
    const [key, value] = part.split('=', 2);
    if (key === 'ts' && value) ts = value;
    else if (key === 'h1' && value) signatures.push(value.toLowerCase());
  }
  if (!ts || !/^\d+$/.test(ts) || signatures.length === 0) return false;
  if (Math.abs(now.getTime() / 1000 - Number(ts)) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expected = toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(`${ts}:${rawBody}`)));
  return signatures.some((sig) => timingSafeEqual(sig, expected));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_MAP: Record<string, EntitlementStatus | undefined> = {
  active: 'active',
  trialing: 'trialing',
  past_due: 'past_due',
  paused: 'paused',
  canceled: 'canceled',
};

interface PaddleSubscriptionEvent {
  event_type?: unknown;
  occurred_at?: unknown;
  data?: {
    id?: unknown;
    status?: unknown;
    customer_id?: unknown;
    custom_data?: { user_id?: unknown } | null;
    current_billing_period?: { ends_at?: unknown } | null;
    billing_cycle?: { interval?: unknown } | null;
    items?: { price?: { id?: unknown; custom_data?: { tier?: unknown } | null } | null }[] | null;
    canceled_at?: unknown;
  };
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * Maps a Paddle `subscription.*` webhook to a billing event. Returns null for
 * events we don't act on. `userId` is null when the checkout didn't carry one
 * (a purchase on the website); the webhook then finds the account by email.
 */
export function toBillingEvent(
  payload: unknown,
  /** Maps our Paddle price IDs to tiers (from the PADDLE_PRICE_* secrets). */
  tierOfPrice: (priceId: string) => PaidTier | undefined,
): IncomingBillingEvent | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const event = payload as PaddleSubscriptionEvent;
  const type = str(event.event_type);
  if (!type?.startsWith('subscription.') || !event.data) return null;

  const data = event.data;
  const claimed = str(data.custom_data?.user_id);
  const userId = claimed && UUID.test(claimed) ? claimed : null;
  const subscriptionId = str(data.id);
  const occurredAt = str(event.occurred_at);
  const status = STATUS_MAP[str(data.status) ?? ''];
  if ((claimed && !userId) || !subscriptionId || !occurredAt || !status) return null;
  // Without a user id we need the customer to find the account.
  if (!userId && !str(data.customer_id)) return null;

  // The tier comes from the subscribed price: our price map first, then the
  // price's own custom_data. An unknown price is ignored rather than guessed.
  const price = data.items?.[0]?.price;
  const priceId = str(price?.id);
  const tagged = str(price?.custom_data?.tier);
  const tier =
    (priceId ? tierOfPrice(priceId) : undefined) ??
    (tagged === 'pro' || tagged === 'advanced' ? tagged : undefined);
  if (!tier) return null;

  const interval = str(data.billing_cycle?.interval);
  return {
    userId,
    occurredAt,
    status,
    // A canceled subscription has no current period; access ends when it was canceled.
    currentPeriodEnd:
      str(data.current_billing_period?.ends_at) ??
      (status === 'canceled' ? (str(data.canceled_at) ?? occurredAt) : null),
    billingInterval: interval === 'month' || interval === 'year' ? interval : null,
    customerId: str(data.customer_id),
    subscriptionId,
    tier,
  };
}

export interface PaddleConfig {
  apiKey: string;
  /** 'sandbox' while testing, 'production' once approved. */
  environment: 'sandbox' | 'production';
}

/** Money due now for a plan change, in the currency's minor units (cents). */
export interface PlanChangePreview {
  action: 'charge' | 'credit' | 'none';
  amount: number;
  currency: string;
}

export class PaddleApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Paddle API ${status}`);
    this.name = 'PaddleApiError';
  }
}

export class PaddleClient {
  constructor(
    private readonly config: PaddleConfig,
    private readonly fetchFn: typeof fetch,
  ) {}

  private get base(): string {
    return this.config.environment === 'production'
      ? 'https://api.paddle.com'
      : 'https://sandbox-api.paddle.com';
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchFn(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (!response.ok) throw new PaddleApiError(response.status, text);
    return (JSON.parse(text) as { data: T }).data;
  }

  /** A checkout URL on our default payment link, carrying `_ptxn`. */
  async createCheckout(input: {
    priceId: string;
    userId: string;
    customerId: string | null;
  }): Promise<string> {
    const data = await this.call<{ checkout?: { url?: string | null } | null }>(
      'POST',
      '/transactions',
      {
        items: [{ price_id: input.priceId, quantity: 1 }],
        custom_data: { user_id: input.userId },
        ...(input.customerId ? { customer_id: input.customerId } : {}),
      },
    );
    const url = data.checkout?.url;
    if (!url) throw new PaddleApiError(502, 'Transaction has no checkout URL');
    return url;
  }

  /**
   * The Paddle customer for an account email: the existing one, or a new one.
   * Binding checkout to it means receipts, invoices and the billing portal use
   * the email the user signed in with, not whatever the checkout form got.
   */
  async customerForEmail(email: string): Promise<string> {
    const found = await this.call<{ id: string }[]>(
      'GET',
      `/customers?email=${encodeURIComponent(email)}&status=active`,
    );
    if (found[0]) return found[0].id;
    const created = await this.call<{ id: string }>('POST', '/customers', { email });
    return created.id;
  }

  /** The email a Paddle customer checked out with. */
  async customerEmail(customerId: string): Promise<string | null> {
    const data = await this.call<{ email?: unknown }>(
      'GET',
      `/customers/${encodeURIComponent(customerId)}`,
    );
    return typeof data.email === 'string' && data.email.includes('@') ? data.email : null;
  }

  /** Tags a subscription with its Rolestash account, so later events name it. */
  async setSubscriptionUser(subscriptionId: string, userId: string): Promise<void> {
    await this.call('PATCH', `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      custom_data: { user_id: userId },
    });
  }

  async createPortalSession(customerId: string, subscriptionId: string | null): Promise<string> {
    const data = await this.call<{ urls: { general: { overview: string } } }>(
      'POST',
      `/customers/${encodeURIComponent(customerId)}/portal-sessions`,
      subscriptionId ? { subscription_ids: [subscriptionId] } : {},
    );
    return data.urls.general.overview;
  }

  /**
   * Moves a subscription to another price now; Paddle prorates the difference
   * and charges (or credits) the saved payment method straight away. If that
   * payment fails, the plan doesn't change.
   */
  async changePrice(subscriptionId: string, priceId: string): Promise<void> {
    await this.call('PATCH', `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      items: [{ price_id: priceId, quantity: 1 }],
      proration_billing_mode: 'prorated_immediately',
      on_payment_failure: 'prevent_change',
    });
  }

  /** What changePrice would charge or credit now, without changing anything. */
  async previewChangePrice(subscriptionId: string, priceId: string): Promise<PlanChangePreview> {
    const data = await this.call<{
      update_summary?: {
        result?: { action?: string; amount?: string; currency_code?: string };
      } | null;
    }>('PATCH', `/subscriptions/${encodeURIComponent(subscriptionId)}/preview`, {
      items: [{ price_id: priceId, quantity: 1 }],
      proration_billing_mode: 'prorated_immediately',
      on_payment_failure: 'prevent_change',
    });
    const result = data.update_summary?.result;
    const amount = Number(result?.amount ?? '0');
    const action =
      result?.action === 'charge' || result?.action === 'credit' ? result.action : 'none';
    if (!Number.isFinite(amount) || !result?.currency_code)
      throw new PaddleApiError(502, 'Preview has no summary');
    return {
      action: amount === 0 ? 'none' : action,
      amount: Math.abs(amount),
      currency: result.currency_code,
    };
  }

  async cancelNow(subscriptionId: string): Promise<void> {
    await this.call('POST', `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
      effective_from: 'immediately',
    });
  }
}
