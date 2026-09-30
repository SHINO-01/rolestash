import { ACTIVE_JOB_LIMITS, type PaidPlan, type PlanState } from '@/domain/plan';
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
      return { label: `Pro trial · ${String(plan.trialDaysLeft ?? 0)}d`, tone: 'accent' };
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
      return `Pro trial: ${String(plan.trialDaysLeft ?? 0)} days left${ends ? `, until ${ends}` : ''}. No card needed.`;
    case 'subscribed':
      return ends ? `${PLAN_NAMES[plan.plan]}. Renews on ${ends}.` : `${PLAN_NAMES[plan.plan]}.`;
    case 'ending':
      return ends
        ? `${PLAN_NAMES[plan.plan]} until ${ends}. Your subscription is canceled.`
        : `${PLAN_NAMES[plan.plan]}, canceled.`;
    case 'trial-ended':
      return 'Your Pro trial has ended. You are on the free plan.';
    case 'lapsed':
      return 'Your subscription has ended. You are on the free plan.';
    case 'stale':
      return "We couldn't confirm your Pro plan for over a week. Check your connection, then refresh.";
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
    default:
      return error instanceof Error && error.message === 'Sign-in was cancelled'
        ? 'Sign-in was cancelled.'
        : 'Something went wrong. Please try again.';
  }
}

export function limitMessage(error: JobLimitError): string {
  return `Your plan holds ${String(error.check.limit)} active jobs, and you have ${String(error.check.active)}. Move finished jobs to Rejected or Withdrawn, or open Account for a bigger plan.`;
}

export const PLAN_NAMES = { free: 'Free', pro: 'Pro', advanced: 'Advanced' } as const;

/** Prices shown in the extension (USD). Checkout shows local prices where set. */
export const PLAN_PRICES: Record<PaidPlan, Record<'month' | 'year', string>> = {
  pro: { month: 'US$7 / month', year: 'US$59 / year' },
  advanced: { month: 'US$15 / month', year: 'US$159 / year' },
};

export const PLAN_PITCH: Record<PaidPlan, string> = {
  pro: `${String(ACTIVE_JOB_LIMITS.pro)} active jobs, full history, reminders, custom columns and capture from a pasted link.`,
  advanced: `${String(ACTIVE_JOB_LIMITS.advanced)} active jobs, sync across devices, automatic status updates from your job emails, and interview details on every card.`,
};
