import {
  ACTIVE_JOB_LIMITS,
  SYNC_DEVICE_LIMITS,
  type PaidPlan,
  type PlanState,
} from '@/domain/plan';
import type { BackendError } from '@/services/backend/supabase-client';
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
    default:
      return error instanceof Error && error.message === 'Sign-in was cancelled'
        ? 'Sign-in was cancelled.'
        : 'Something went wrong. Please try again.';
  }
}

export function limitMessage(error: JobLimitError): string {
  return `Your plan holds ${String(error.check.limit)} active jobs, and you have ${String(error.check.active)}. Archive finished jobs or move them to Rejected or Withdrawn, or open Account for a bigger plan.`;
}

export const PLAN_NAMES = { free: 'Free', pro: 'Pro', advanced: 'Advanced' } as const;

/** Prices shown in the extension (USD). Checkout shows local prices where set. */
export const PLAN_PRICES: Record<PaidPlan, Record<'month' | 'year', string>> = {
  pro: { month: 'US$7 / month', year: 'US$59 / year' },
  advanced: { month: 'US$15 / month', year: 'US$159 / year' },
};

export const PLAN_PITCH: Record<PaidPlan, string> = {
  pro: `${String(ACTIVE_JOB_LIMITS.pro)} active jobs, application autofill, insights, contacts and documents, bulk actions, full history, reminders, custom columns, capture from a pasted link, and sync across ${String(SYNC_DEVICE_LIMITS.pro)} computers.`,
  advanced: `Unlimited active jobs, automatic status updates from your job emails, interview details on every card, sync across ${String(SYNC_DEVICE_LIMITS.advanced)} devices including your phone, and your whole board in the side panel.`,
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
