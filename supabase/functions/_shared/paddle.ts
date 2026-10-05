/**
 * Paddle Billing: webhook verification, event → entitlement mapping, and the
 * few API calls we make. Pure TypeScript with injected fetch, so the same
 * code runs in Supabase Edge Functions (Deno) and in Vitest.
 */

export type PaidTier = 'pro' | 'advanced';
export type BillingInterval = 'month' | 'quarter' | 'year';

export type EntitlementStatus =
  'trialing' | 'active' | 'past_due' | 'paused' | 'canceled' | 'expired';

/**
 * A webhook's event before we know whose it is. `userId` and
 * `checkoutSignature` are only what the checkout's custom_data says: anyone
 * can open a Paddle.js checkout with any custom_data (ADR-0027).
 */
export type IncomingBillingEvent = Omit<BillingEvent, 'userId'> & {
  userId: string | null;
  checkoutSignature: string | null;
};

/** What apply_billing_event() needs (supabase/migrations). */
export interface BillingEvent {
  userId: string;
  occurredAt: string;
  status: EntitlementStatus;
  currentPeriodEnd: string | null;
  billingInterval: BillingInterval | null;
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

/**
 * What create-checkout puts in custom_data.checkout_sig: an HMAC of the
 * account id under a server-only secret, so the webhook can tell a checkout
 * we made for that signed-in account from one a browser made up (ADR-0027).
 */
export async function checkoutSignature(secret: string, userId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(
    await crypto.subtle.sign('HMAC', key, encoder.encode(`rolestash checkout v1:${userId}`)),
  );
}

export async function verifyCheckoutSignature(
  secret: string,
  userId: string,
  signature: string | null,
): Promise<boolean> {
  if (!secret || !signature) return false;
  return timingSafeEqual(signature.toLowerCase(), await checkoutSignature(secret, userId));
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
    custom_data?: { user_id?: unknown; checkout_sig?: unknown } | null;
    current_billing_period?: { ends_at?: unknown } | null;
    billing_cycle?: { interval?: unknown; frequency?: unknown } | null;
    items?: { price?: { id?: unknown; custom_data?: { tier?: unknown } | null } | null }[] | null;
    canceled_at?: unknown;
    scheduled_change?: { action?: unknown; effective_at?: unknown } | null;
  };
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * Maps a Paddle `subscription.*` webhook to a billing event. Returns null for
 * events we don't act on. `userId` is null when the checkout didn't carry one.
 * A `userId` is only what the checkout claimed (a buyer can set it), so the
 * webhook checks the claim before applying it (ADR-0027).
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
  const reported = STATUS_MAP[str(data.status) ?? ''];
  // Cancelled to end at the period's end: still paid until then, but ending, not renewing.
  const endsAt =
    str(data.scheduled_change?.action) === 'cancel'
      ? str(data.scheduled_change?.effective_at)
      : null;
  const status =
    endsAt && (reported === 'active' || reported === 'past_due') ? 'canceled' : reported;
  if ((claimed && !userId) || !subscriptionId || !occurredAt || !status) return null;

  // The tier comes from the subscribed price: our price map first, then the
  // price's own custom_data. An unknown price is ignored rather than guessed.
  const price = data.items?.[0]?.price;
  const priceId = str(price?.id);
  const tagged = str(price?.custom_data?.tier);
  const tier =
    (priceId ? tierOfPrice(priceId) : undefined) ??
    (tagged === 'pro' || tagged === 'advanced' ? tagged : undefined);
  if (!tier) return null;

  // Paddle bills quarterly plans as every 3 months.
  const cycle = str(data.billing_cycle?.interval);
  const every = data.billing_cycle?.frequency ?? 1;
  const interval: BillingInterval | null =
    cycle === 'year' && every === 1
      ? 'year'
      : cycle === 'month' && every === 3
        ? 'quarter'
        : cycle === 'month' && every === 1
          ? 'month'
          : null;
  return {
    userId,
    checkoutSignature: str(data.custom_data?.checkout_sig),
    occurredAt,
    status,
    // A canceled subscription has no current period; access ends when it was canceled.
    currentPeriodEnd:
      endsAt ??
      str(data.current_billing_period?.ends_at) ??
      (status === 'canceled' ? (str(data.canceled_at) ?? occurredAt) : null),
    billingInterval: interval,
    customerId: str(data.customer_id),
    subscriptionId,
    tier,
  };
}

/** A full refund or chargeback Paddle approved for a subscription payment. */
export interface RefundEvent {
  adjustmentId: string;
  transactionId: string;
  subscriptionId: string;
}

/**
 * Maps a Paddle `adjustment.*` webhook to a refund that ends the plan:
 * approved, the whole payment (`type: full`), a refund or chargeback, for a
 * subscription. Partial refunds, credits and pending ones keep the plan.
 */
export function toRefundEvent(payload: unknown): RefundEvent | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const event = payload as { event_type?: unknown; data?: Record<string, unknown> | null };
  const type = str(event.event_type);
  if ((type !== 'adjustment.created' && type !== 'adjustment.updated') || !event.data) return null;
  const data = event.data;
  const action = str(data.action);
  if (action !== 'refund' && action !== 'chargeback') return null;
  if (str(data.status) !== 'approved' || str(data.type) !== 'full') return null;
  const adjustmentId = str(data.id);
  const transactionId = str(data.transaction_id);
  const subscriptionId = str(data.subscription_id);
  return adjustmentId && transactionId && subscriptionId
    ? { adjustmentId, transactionId, subscriptionId }
    : null;
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
  /** The new plan's regular price, in the same currency (minor units). */
  recurring?: number;
  /** When it's next billed (ISO). */
  nextBilledAt?: string;
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

  /** Sets the name Paddle shows on receipts and in Subscription Management. */
  async updateCustomerName(customerId: string, name: string): Promise<void> {
    await this.call('PATCH', `/customers/${encodeURIComponent(customerId)}`, { name });
  }

  /** A checkout URL on our default payment link, carrying `_ptxn`. */
  async createCheckout(input: {
    priceId: string;
    userId: string;
    /** checkoutSignature() of userId, so the webhook trusts the claim. */
    signature: string;
    customerId: string | null;
  }): Promise<string> {
    const data = await this.call<{ checkout?: { url?: string | null } | null }>(
      'POST',
      '/transactions',
      {
        items: [{ price_id: input.priceId, quantity: 1 }],
        custom_data: { user_id: input.userId, checkout_sig: input.signature },
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
      recurring_transaction_details?: {
        totals?: { total?: string; currency_code?: string } | null;
      } | null;
      next_billed_at?: string | null;
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
    const recurring = data.recurring_transaction_details?.totals;
    const regular = Number(recurring?.total);
    return {
      action: amount === 0 ? 'none' : action,
      amount: Math.abs(amount),
      currency: result.currency_code,
      ...(recurring?.currency_code === result.currency_code && Number.isFinite(regular)
        ? { recurring: regular }
        : {}),
      ...(data.next_billed_at ? { nextBilledAt: data.next_billed_at } : {}),
    };
  }

  /**
   * Prices as Paddle would charge someone at this IP address: their currency,
   * local overrides or Paddle's conversion, and tax as shown at checkout.
   * Returns Paddle's own formatted totals by price ID.
   */
  async localPrices(
    priceIds: readonly string[],
    ip: string | null,
  ): Promise<{ currency: string; country: string | null; totals: Record<string, string> }> {
    const data = await this.call<{
      currency_code?: string;
      address?: { country_code?: string } | null;
      details?: {
        line_items?: { price?: { id?: string }; formatted_totals?: { total?: string } }[];
      };
    }>('POST', '/pricing-preview', {
      items: priceIds.map((price_id) => ({ price_id, quantity: 1 })),
      // Without an IP, Paddle prices for the US.
      ...(ip ? { customer_ip_address: ip } : { address: { country_code: 'US' } }),
    });
    const totals: Record<string, string> = {};
    for (const line of data.details?.line_items ?? []) {
      if (line.price?.id && line.formatted_totals?.total)
        totals[line.price.id] = line.formatted_totals.total;
    }
    return {
      currency: data.currency_code ?? 'USD',
      country: data.address?.country_code ?? null,
      totals,
    };
  }

  /** A subscription's status and when its current billing period started. */
  async subscriptionPeriod(
    subscriptionId: string,
  ): Promise<{ status: string | null; startsAt: string | null }> {
    const data = await this.call<{
      status?: unknown;
      current_billing_period?: { starts_at?: unknown } | null;
    }>('GET', `/subscriptions/${encodeURIComponent(subscriptionId)}`);
    return { status: str(data.status), startsAt: str(data.current_billing_period?.starts_at) };
  }

  /** When the billing period a transaction paid for started (null if none). */
  async transactionPeriodStart(transactionId: string): Promise<string | null> {
    const data = await this.call<{ billing_period?: { starts_at?: unknown } | null }>(
      'GET',
      `/transactions/${encodeURIComponent(transactionId)}`,
    );
    return str(data.billing_period?.starts_at);
  }

  async cancelNow(subscriptionId: string): Promise<void> {
    await this.call('POST', `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
      effective_from: 'immediately',
    });
  }
}
