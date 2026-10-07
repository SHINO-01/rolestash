import {
  SYNC_DEVICE_LIMITS,
  type BillingInterval,
  type PaidPlan,
  type PlanState,
} from '@/domain/plan';
import type { BackendError, Referral } from '@/services/backend/supabase-client';
import type { JobLimitError } from '@/services/job-service';
import { formatDate } from '@/ui/format';

/** Short plan label for the header chip. */
export function planChip(plan: PlanState): {
  label: string;
  tone: 'accent' | 'neutral' | 'warning';
} {
  switch (plan.reason) {
    case 'trial':
      return {
        label: `${PLAN_NAMES[plan.plan]} trial · ${String(plan.trialDaysLeft ?? 0)}d`,
        tone: 'accent',
      };
    case 'subscribed':
    case 'ending':
      return { label: PLAN_NAMES[plan.plan], tone: 'accent' };
    case 'stale':
      return { label: 'Plan unconfirmed', tone: 'warning' };
    default:
      return { label: 'Free', tone: 'neutral' };
  }
}

/** One-line description for the account dialog. */
export function planSummary(plan: PlanState): string {
  const ends = formatDate(plan.endsAt);
  switch (plan.reason) {
    case 'trial':
      return `${PLAN_NAMES[plan.plan]} trial: ${String(plan.trialDaysLeft ?? 0)} days left${ends ? `, until ${ends}` : ''}. No card needed.`;
    case 'subscribed':
      if (plan.complimentary)
        return ends
          ? `${PLAN_NAMES[plan.plan]}, complimentary until ${ends}. No subscription needed.`
          : `${PLAN_NAMES[plan.plan]}, complimentary. No subscription needed.`;
      return ends ? `${PLAN_NAMES[plan.plan]}. Renews on ${ends}.` : `${PLAN_NAMES[plan.plan]}.`;
    case 'ending':
      return ends
        ? `${PLAN_NAMES[plan.plan]} until ${ends}. Your subscription is canceled.`
        : `${PLAN_NAMES[plan.plan]}, canceled.`;
    case 'trial-ended':
      return 'Your free trial has ended. You are on the free plan.';
    case 'lapsed':
      return 'Your subscription has ended. You are on the free plan.';
    case 'stale':
      return "We couldn't confirm your plan for over a week. Check your connection, then refresh.";
    case 'no-account':
      return 'Free plan.';
  }
}

export function backendErrorMessage(error: unknown): string {
  const code = (error as Partial<BackendError> | null)?.code;
  switch (code) {
    case 'network':
      return "Can't reach Rolestash. Check your connection and try again.";
    case 'invalid_code':
      return 'That code is wrong or has expired. Check the latest email, or send a new code.';
    case 'rate_limited':
      return 'Too many attempts. Please wait a minute and try again.';
    case 'session_expired':
      return 'You were signed out. Please sign in again.';
    case 'already_subscribed':
      return 'You already have a subscription. Use "Manage subscription" to change it.';
    case 'no_subscription':
      return 'There is no subscription to manage yet.';
    case 'sync_not_allowed':
      return 'This browser can’t sync on your current plan, or it was removed from sync.';
    case 'promo_code_invalid':
      return 'That code isn’t valid for this plan, or it has expired.';
    case 'promo_code_unusable':
      return 'Referral codes are for a friend’s first subscription, so this one can’t be used here.';
    case 'promo_code_limited':
      return 'Too many codes tried. Please wait an hour and try again.';
    default:
      return error instanceof Error && error.message === 'Sign-in was cancelled'
        ? 'Sign-in was cancelled.'
        : 'Something went wrong. Please try again.';
  }
}

/** "1 friend joined · 2 free months earned", or a nudge when there are none yet. */
export function referralCounts(referral: Pick<Referral, 'joined' | 'earned'>): string {
  const joined = referral.joined ?? 0;
  const earned = referral.earned ?? 0;
  if (joined === 0) return 'No friends have joined yet.';
  const friends = `${String(joined)} friend${joined === 1 ? '' : 's'} joined`;
  const months = `${String(earned)} free month${earned === 1 ? '' : 's'} earned`;
  return `${friends} · ${months}`;
}

export function limitMessage(error: JobLimitError): string {
  return `Your plan holds ${String(error.check.limit)} active jobs, and you have ${String(error.check.active)}. Archive finished jobs or move them to Rejected, or upgrade to Pro for unlimited jobs.`;
}

export const PLAN_NAMES = { free: 'Free', pro: 'Pro' } as const;

/** Prices shown in the extension (USD). Checkout shows local prices where set. */
export const PLAN_PRICES: Record<PaidPlan, Record<BillingInterval, string>> = {
  pro: { month: 'US$12 / month', quarter: 'US$30 / 3 months', year: 'US$99 / year' },
};

/** "A$10.00 / month" in the user's currency when known, else the US price. */
export function planPriceLabel(
  tier: PaidPlan,
  interval: BillingInterval,
  local: { prices: Record<PaidPlan, Record<BillingInterval, string>> } | undefined,
): string {
  const price = local?.prices[tier][interval];
  if (!price) return PLAN_PRICES[tier][interval];
  return `${price} ${{ month: '/ month', quarter: '/ 3 months', year: '/ year' }[interval]}`;
}

export const PLAN_PITCH: Record<PaidPlan, string> = {
  pro: `Unlimited active jobs, status updates from your job emails, full autofill, insights, contacts and documents, reminders, and sync across ${String(SYNC_DEVICE_LIMITS.pro)} devices including your phone.`,
};

/** "US$8.48" from minor units, with the currency's own decimals. */
export function formatMinor(amount: number, currency: string): string {
  const format = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    currencyDisplay: 'symbol',
  });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(amount / 10 ** digits);
}
