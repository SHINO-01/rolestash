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

/** `pro-month` → { tier: 'pro', interval: 'month' }; null for anything else. */
export function parseCheckoutIntent(value: string | null): CheckoutIntent | null {
  const [tier, interval, ...rest] = (value ?? '').split('-');
  if (rest.length) return null;
  const plan = PAID_PLANS.find((p) => p === tier);
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
  const fromUrl = parseCheckoutIntent(url.searchParams.get('checkout'));
  if (url.searchParams.has('checkout')) {
    url.searchParams.delete('checkout');
    history.replaceState(history.state, '', url);
  }
  try {
    if (fromUrl) sessionStorage.setItem(KEY, `${fromUrl.tier}-${fromUrl.interval}`);
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
