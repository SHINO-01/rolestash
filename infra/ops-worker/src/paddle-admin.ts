import type { Deps, Env } from './panels';

/**
 * Paddle changes the dashboard makes (ADR-0035, ADR-0037): discount codes,
 * the referral discount, and a referrer's free month (the next renewal moved
 * out by a month, no charge). Uses PADDLE_API_KEY, which needs Discounts and
 * Subscriptions write on top of the panels' read scopes.
 */

export type Interval = 'month' | 'quarter' | 'year';
export const INTERVALS: readonly Interval[] = ['month', 'quarter', 'year'];
export const INTERVAL_LABEL: Record<Interval, string> = {
  month: 'Monthly',
  quarter: 'Every 3 months',
  year: 'Yearly',
};

/** How many payments a code takes money off. */
export type Payments = 'first' | 'three' | 'all';
export const PAYMENTS_LABEL: Record<Payments, string> = {
  first: 'the first payment',
  three: 'the first 3 payments',
  all: 'every payment',
};

export class PaddleAdminError extends Error {
  override name = 'PaddleAdminError';
}

export interface Discount {
  id: string;
  code: string | null;
  description: string;
  status: string;
  type: string;
  /** Percent for percentage discounts. */
  amount: string;
  restrictTo: string[] | null;
  expiresAt: string | null;
  usageLimit: number | null;
  timesUsed: number;
  recur: boolean;
  maxRecurring: number | null;
  /** Ours from the dashboard: 'code' or 'referral' (custom_data.kind). */
  kind: string | null;
  createdAt: string;
}

const base = (env: Env) =>
  env.PADDLE_ENV === 'sandbox' ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com';

export const paddleConfigured = (env: Env): boolean => Boolean(env.PADDLE_API_KEY);

async function call<T>(
  env: Env,
  deps: Deps,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  if (!env.PADDLE_API_KEY) throw new PaddleAdminError('Paddle changes need PADDLE_API_KEY.');
  const response = await deps.fetch(`${base(env)}${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.PADDLE_API_KEY}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(8_000),
  });
  const text = await response.text();
  if (!response.ok) {
    let detail = '';
    try {
      const error = (JSON.parse(text) as { error?: { detail?: string; code?: string } }).error;
      detail = error?.detail ?? error?.code ?? '';
    } catch {
      // not JSON
    }
    if (response.status === 403)
      throw new PaddleAdminError(
        'Paddle refused: the API key needs Discounts and Subscriptions write access.',
      );
    throw new PaddleAdminError(
      `Paddle said ${String(response.status)}${detail ? `: ${detail.slice(0, 200)}` : ''}.`,
    );
  }
  return (JSON.parse(text) as { data: T }).data;
}

interface RawDiscount {
  id: string;
  code?: string | null;
  description?: string;
  status?: string;
  type?: string;
  amount?: string;
  restrict_to?: string[] | null;
  expires_at?: string | null;
  usage_limit?: number | null;
  times_used?: number | null;
  recur?: boolean;
  maximum_recurring_intervals?: number | null;
  custom_data?: { app?: string; kind?: string } | null;
  created_at?: string;
}

const toDiscount = (d: RawDiscount): Discount => ({
  id: d.id,
  code: d.code ?? null,
  description: d.description ?? '',
  status: d.status ?? 'unknown',
  type: d.type ?? 'percentage',
  amount: d.amount ?? '0',
  restrictTo: d.restrict_to ?? null,
  expiresAt: d.expires_at ?? null,
  usageLimit: d.usage_limit ?? null,
  timesUsed: d.times_used ?? 0,
  recur: d.recur ?? false,
  maxRecurring: d.maximum_recurring_intervals ?? null,
  kind: d.custom_data?.app === 'rolestash' ? (d.custom_data.kind ?? null) : null,
  createdAt: d.created_at ?? '',
});

/** Every discount, newest first. */
export async function listDiscounts(env: Env, deps: Deps): Promise<Discount[]> {
  const data = await call<RawDiscount[]>(env, deps, 'GET', '/discounts?per_page=200');
  return data.map(toDiscount).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Is a discount usable today (active, not expired, not used up)? */
export function isLive(d: Discount, now: Date): boolean {
  if (d.status !== 'active') return false;
  if (d.expiresAt && Date.parse(d.expiresAt) <= now.getTime()) return false;
  return d.usageLimit === null || d.timesUsed < d.usageLimit;
}

/** The current Pro prices by interval (the Rolestash product's active prices). */
export async function proPrices(env: Env, deps: Deps): Promise<Record<Interval, string>> {
  const products = await call<
    { id: string; custom_data?: { app?: string; tier?: string } | null }[]
  >(env, deps, 'GET', '/products?status=active&per_page=200');
  const pro = products.find(
    (p) => p.custom_data?.app === 'rolestash' && p.custom_data.tier === 'pro',
  );
  if (!pro) throw new PaddleAdminError('No Rolestash Pro product in Paddle.');
  const prices = await call<
    { id: string; billing_cycle?: { interval?: string; frequency?: number } | null }[]
  >(
    env,
    deps,
    'GET',
    `/prices?product_id=${encodeURIComponent(pro.id)}&status=active&per_page=200`,
  );
  const found: Partial<Record<Interval, string>> = {};
  for (const price of prices) {
    const c = price.billing_cycle;
    const interval: Interval | undefined =
      c?.interval === 'year' && c.frequency === 1
        ? 'year'
        : c?.interval === 'month' && c.frequency === 3
          ? 'quarter'
          : c?.interval === 'month' && c.frequency === 1
            ? 'month'
            : undefined;
    if (interval && !found[interval]) found[interval] = price.id;
  }
  if (!found.month || !found.quarter || !found.year)
    throw new PaddleAdminError('A current Pro price is missing in Paddle.');
  return found as Record<Interval, string>;
}

export interface NewCode {
  code: string;
  percent: number;
  intervals: Interval[];
  payments: Payments;
  /** Last day it can be used (Sydney), YYYY-MM-DD. */
  until?: string;
  limit?: number;
}

/** The end of a Sydney day as an ISO instant (Sydney is UTC+10 or +11). */
export function sydneyEndOfDay(date: string): string {
  // 23:59:59 in Sydney is 12:59:59 or 13:59:59 UTC the same day. Work it out
  // with the platform's time zone data rather than guessing daylight saving.
  const probe = new Date(`${date}T13:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(probe);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  // At 13:00 UTC Sydney reads 23:00 (AEST) or 00:00 the next day (AEDT).
  const offsetHours = hour === 23 ? 10 : 11;
  return new Date(Date.parse(`${date}T23:59:59Z`) - offsetHours * 3_600_000).toISOString();
}

export async function createCode(env: Env, deps: Deps, input: NewCode): Promise<Discount> {
  const prices = await proPrices(env, deps);
  const data = await call<RawDiscount>(env, deps, 'POST', '/discounts', {
    description: `${input.code}: ${String(input.percent)}% off ${PAYMENTS_LABEL[input.payments]}`,
    type: 'percentage',
    amount: String(input.percent),
    code: input.code,
    enabled_for_checkout: true,
    recur: input.payments !== 'first',
    ...(input.payments === 'three' ? { maximum_recurring_intervals: 3 } : {}),
    restrict_to: input.intervals.map((i) => prices[i]),
    ...(input.until ? { expires_at: sydneyEndOfDay(input.until) } : {}),
    ...(input.limit ? { usage_limit: input.limit } : {}),
    custom_data: { app: 'rolestash', kind: 'code' },
  });
  return toDiscount(data);
}

/** The referral discount: N% off a friend's first monthly payment; not typeable in checkout. */
export async function createReferralDiscount(
  env: Env,
  deps: Deps,
  percent: number,
): Promise<Discount> {
  const prices = await proPrices(env, deps);
  const data = await call<RawDiscount>(env, deps, 'POST', '/discounts', {
    description: `Referral: ${String(percent)}% off the first month`,
    type: 'percentage',
    amount: String(percent),
    enabled_for_checkout: false,
    recur: false,
    restrict_to: [prices.month],
    custom_data: { app: 'rolestash', kind: 'referral' },
  });
  return toDiscount(data);
}

export async function archiveDiscount(env: Env, deps: Deps, id: string): Promise<void> {
  await call(env, deps, 'PATCH', `/discounts/${encodeURIComponent(id)}`, { status: 'archived' });
}

/** One month after an ISO date, keeping the day where it exists (31 Jan → 28/29 Feb). */
export function plusOneMonth(iso: string): string {
  const d = new Date(iso);
  const day = d.getUTCDate();
  const next = new Date(d);
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, last));
  return next.toISOString();
}

/**
 * A referrer's free month (ADR-0035): their next renewal moves out by a month,
 * with no charge. Fails (ok: false) when the subscription can't be moved, so
 * the caller gives a dated grant instead.
 */
export async function moveRenewal(
  env: Env,
  deps: Deps,
  subscriptionId: string,
): Promise<{ ok: boolean; detail: string }> {
  const sub = await call<{
    status?: string;
    next_billed_at?: string | null;
    scheduled_change?: unknown;
  }>(env, deps, 'GET', `/subscriptions/${encodeURIComponent(subscriptionId)}`);
  if (sub.status !== 'active' || !sub.next_billed_at || sub.scheduled_change)
    return { ok: false, detail: `subscription ${sub.status ?? 'unknown'}, not renewing` };
  const next = plusOneMonth(sub.next_billed_at);
  await call(env, deps, 'PATCH', `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    next_billed_at: next,
    proration_billing_mode: 'do_not_bill',
  });
  return {
    ok: true,
    detail: `next bill moved from ${sub.next_billed_at.slice(0, 10)} to ${next.slice(0, 10)}`,
  };
}
