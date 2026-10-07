import { BILLING_INTERVALS, PAID_PLANS, type BillingInterval, type PaidPlan } from '@/domain/plan';

/**
 * A plan chosen on rolestash.com/pricing/ (ADR-0027). The pricing page sends
 * buyers to /board/?checkout=<tier>-<interval>; the board signs them in, then
 * opens checkout for their own account. The choice is kept in sessionStorage
 * so it survives the Google sign-in round trip in this tab.
 */
export interface CheckoutIntent {
  tier: PaidPlan;
  interval: BillingInterval;
}

const KEY = 'rolestash:checkout-intent';

/**
 * `pro-month` → { tier: 'pro', interval: 'month' }; null for anything else.
 * `advanced-…` links from before the plans merged mean Pro (ADR-0029).
 */
export function parseCheckoutIntent(value: string | null): CheckoutIntent | null {
  const [tier, interval, ...rest] = (value ?? '').split('-');
  if (rest.length) return null;
  const plan = PAID_PLANS.find((p) => p === (tier === 'advanced' ? 'pro' : tier));
  const every = BILLING_INTERVALS.find((i) => i === interval);
  return plan && every ? { tier: plan, interval: every } : null;
}

/**
 * Moves `?checkout=` from the address bar into this tab's storage (so a
 * reload or a shared link doesn't keep re-opening checkout), then returns the
 * pending choice, if any.
 */
export function takeCheckoutIntent(): CheckoutIntent | null {
  const url = new URL(location.href);
  const raw = url.searchParams.get('checkout');
  const fromUrl = parseCheckoutIntent(raw);
  if (url.searchParams.has('checkout')) {
    url.searchParams.delete('checkout');
    history.replaceState(history.state, '', url);
  }
  try {
    // Only a plan and interval (e.g. "pro-month"), and only once it parses.
    if (fromUrl && raw) sessionStorage.setItem(KEY, raw);
    return parseCheckoutIntent(sessionStorage.getItem(KEY));
  } catch {
    return fromUrl;
  }
}

export function clearCheckoutIntent(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing stored
  }
}

/**
 * A promo code or referral link's code (ADR-0035), kept in this tab by the
 * pricing page (site/assets/pricing.js, same key) or taken from this page's
 * own ?code= / ?ref=. Sent to create-checkout, which checks it.
 */
export interface Promo {
  code?: string;
  ref?: string;
}

const PROMO_KEY = 'rolestash:promo';
const CODE = /^[A-Za-z0-9_-]{2,40}$/;

export function parsePromo(value: unknown): Promo {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const promo: Promo = {};
  for (const key of ['code', 'ref'] as const) {
    const v = raw[key];
    if (typeof v === 'string' && CODE.test(v.trim())) promo[key] = v.trim().toUpperCase();
  }
  return promo;
}

export function takePromo(): Promo {
  const url = new URL(location.href);
  let promo: Promo = {};
  try {
    promo = parsePromo(JSON.parse(sessionStorage.getItem(PROMO_KEY) ?? '{}'));
  } catch {
    // nothing stored
  }
  const fromUrl = parsePromo({
    code: url.searchParams.get('code'),
    ref: url.searchParams.get('ref'),
  });
  if (url.searchParams.has('code') || url.searchParams.has('ref')) {
    url.searchParams.delete('code');
    url.searchParams.delete('ref');
    history.replaceState(history.state, '', url);
  }
  promo = { ...promo, ...fromUrl };
  savePromo(promo);
  return promo;
}

export function savePromo(promo: Promo): void {
  try {
    if (promo.code || promo.ref) sessionStorage.setItem(PROMO_KEY, JSON.stringify(promo));
    else sessionStorage.removeItem(PROMO_KEY);
  } catch {
    // Private mode: the code just isn't kept.
  }
}
