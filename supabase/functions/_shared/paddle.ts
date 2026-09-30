/**
 * Paddle Billing: webhook verification, event → entitlement mapping, and the
 * few API calls we make. Pure TypeScript with injected fetch, so the same
 * code runs in Supabase Edge Functions (Deno) and in Vitest.
 */

export type EntitlementStatus =
  'trialing' | 'active' | 'past_due' | 'paused' | 'canceled' | 'expired';

/** What apply_billing_event() needs (supabase/migrations). */
export interface BillingEvent {
  userId: string;
  occurredAt: string;
  status: EntitlementStatus;
  currentPeriodEnd: string | null;
  billingInterval: 'month' | 'year' | null;
  customerId: string | null;
  subscriptionId: string;
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
    canceled_at?: unknown;
  };
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * Maps a Paddle `subscription.*` webhook to a BillingEvent. Returns null for
 * events we don't act on (other types, or subscriptions not started from our
 * checkout, which carry no user id).
 */
export function toBillingEvent(payload: unknown): BillingEvent | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const event = payload as PaddleSubscriptionEvent;
  const type = str(event.event_type);
  if (!type?.startsWith('subscription.') || !event.data) return null;

  const data = event.data;
  const userId = str(data.custom_data?.user_id);
  const subscriptionId = str(data.id);
  const occurredAt = str(event.occurred_at);
  const status = STATUS_MAP[str(data.status) ?? ''];
  if (!userId || !UUID.test(userId) || !subscriptionId || !occurredAt || !status) return null;

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
  };
}

export interface PaddleConfig {
  apiKey: string;
  /** 'sandbox' while testing, 'production' once approved. */
  environment: 'sandbox' | 'production';
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

  async createPortalSession(customerId: string, subscriptionId: string | null): Promise<string> {
    const data = await this.call<{ urls: { general: { overview: string } } }>(
      'POST',
      `/customers/${encodeURIComponent(customerId)}/portal-sessions`,
      subscriptionId ? { subscription_ids: [subscriptionId] } : {},
    );
    return data.urls.general.overview;
  }

  async cancelNow(subscriptionId: string): Promise<void> {
    await this.call('POST', `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
      effective_from: 'immediately',
    });
  }
}
