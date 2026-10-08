import { z } from 'zod';
import type { Job } from './job';
import { findStage, type Stage } from './stage';

/**
 * Free and Pro (ADR-0009, ADR-0013, ADR-0029). Pure rules only: where the
 * entitlement comes from (Supabase) and where limits are enforced
 * (JobService) live elsewhere.
 *
 * Until 2026-10-06 there were two paid plans, Pro; they merged
 * into one Pro plan with everything (ADR-0029). The server still stores the
 * paid tier as `advanced`, and entitlements may say either; both mean Pro.
 */

/** Plans, lowest first. */
export const PLANS = ['free', 'pro'] as const;
export type Plan = (typeof PLANS)[number];
/** The paid plan a subscription can be on. */
export type PaidPlan = Exclude<Plan, 'free'>;
export const PAID_PLANS: readonly PaidPlan[] = ['pro'];
/** How often a paid plan bills. Quarterly suits a typical ~3-month job search. */
export const BILLING_INTERVALS = ['month', 'quarter', 'year'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

/**
 * Jobs outside a `lost` stage each plan may hold. Pro has no limit; the
 * server's 5,000 synced-job cap (synced_jobs_cap) is the fair-use backstop.
 */
export const ACTIVE_JOB_LIMITS: Readonly<Record<Plan, number>> = {
  free: 30,
  pro: Number.POSITIVE_INFINITY,
};

/** The paid features. Every one is part of Pro (ADR-0029). */
export const FEATURES = [
  'history',
  'reminders',
  'customColumns',
  'pasteLink',
  'sync',
  /** Autofill beyond the basic fields, saved answers and résumé import. Basic autofill is free. */
  'fullAutofill',
  'insights',
  'records',
  'bulk',
  'emailUpdates',
  'webBoard',
] as const;
export type Feature = (typeof FEATURES)[number];

/**
 * May this plan use the feature? `undefined` is a build without accounts,
 * where nothing is limited because there is no way to upgrade.
 */
export function allows(plan: Plan | undefined, _feature: Feature): boolean {
  return plan === undefined || plan !== 'free';
}

/** "30 active jobs" or "Unlimited active jobs". */
export function activeJobsLabel(plan: Plan): string {
  const limit = ACTIVE_JOB_LIMITS[plan];
  return Number.isFinite(limit) ? `${String(limit)} active jobs` : 'Unlimited active jobs';
}
/** Devices that may sync one account, phones (through the web board) included. */
export const SYNC_DEVICE_LIMITS: Readonly<Record<Plan, number>> = {
  free: 0,
  pro: 5,
};
export const FREE_ACTIVE_JOB_LIMIT = ACTIVE_JOB_LIMITS.free;
export const TRIAL_DAYS = 14;
/** How long a cached paid entitlement stays valid without reaching the server. */
export const OFFLINE_GRACE_DAYS = 7;
/** Slack after a period ends, so a late renewal webhook doesn't flip a payer to Free. */
export const RENEWAL_LEEWAY_DAYS = 3;

const DAY_MS = 86_400_000;
const IsoDateTime = z.iso.datetime({ offset: true });

/** Mirrors the `entitlement_status` enum in supabase/migrations. */
export const ENTITLEMENT_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'paused',
  'canceled',
  'expired',
] as const;
export type EntitlementStatus = (typeof ENTITLEMENT_STATUSES)[number];

/** The account's entitlement as last read from the server. */
export const EntitlementSchema = z.object({
  status: z.enum(ENTITLEMENT_STATUSES),
  trialEndsAt: IsoDateTime.optional(),
  currentPeriodEnd: IsoDateTime.optional(),
  /** The server's tier. Both values mean Pro since the plans merged (ADR-0029). */
  tier: z.enum(['pro', 'advanced']).optional(),
  /** Granted by hand with no subscription (ADR-0025): no renewal date, no plan changes. */
  complimentary: z.boolean().optional(),
  /** Why a complimentary plan was granted (ADR-0035), e.g. "tester". */
  grantReason: z.string().max(40).optional(),
  /** When this snapshot was fetched; drives the offline grace period. */
  checkedAt: IsoDateTime,
});
export type Entitlement = z.infer<typeof EntitlementSchema>;

export type PlanReason =
  /** Signed out, or no entitlement fetched yet. */
  | 'no-account'
  | 'trial'
  | 'subscribed'
  /** Paid access continuing after cancel/until the paid period ends. */
  | 'ending'
  | 'trial-ended'
  | 'lapsed'
  /** Paid on paper, but not confirmed with the server for too long. */
  | 'stale';

export interface PlanState {
  plan: Plan;
  reason: PlanReason;
  /** When paid access ends or renews, if known. */
  endsAt?: string;
  /** Whole days of trial left (ceil), only while trialing. */
  trialDaysLeft?: number;
  /** A complimentary plan (ADR-0025): paid features with no subscription. */
  complimentary?: true;
  /** Its reason (ADR-0035), e.g. "tester" for someone testing Rolestash. */
  grantReason?: string;
}

const before = (now: Date, iso: string | undefined, slackDays = 0) =>
  iso !== undefined && now.getTime() < Date.parse(iso) + slackDays * DAY_MS;

export function planOf(entitlement: Entitlement | undefined, now: Date): PlanState {
  if (!entitlement) return { plan: 'free', reason: 'no-account' };
  const { status, trialEndsAt, currentPeriodEnd, checkedAt } = entitlement;
  const tier: PaidPlan = 'pro';

  let state: PlanState;
  switch (status) {
    case 'trialing':
      state = before(now, trialEndsAt)
        ? {
            plan: tier,
            reason: 'trial',
            ...(trialEndsAt ? { endsAt: trialEndsAt } : {}),
            trialDaysLeft: Math.max(
              0,
              Math.ceil((Date.parse(trialEndsAt ?? '') - now.getTime()) / DAY_MS),
            ),
          }
        : { plan: 'free', reason: 'trial-ended' };
      break;
    case 'active':
    case 'past_due':
      if (entitlement.complimentary && status === 'active' && before(now, currentPeriodEnd)) {
        // A dated grant (ADR-0035) shows its end; an indefinite one ends in 9999.
        const dated = currentPeriodEnd !== undefined && !currentPeriodEnd.startsWith('9999-');
        state = {
          plan: tier,
          reason: 'subscribed',
          complimentary: true,
          ...(entitlement.grantReason ? { grantReason: entitlement.grantReason } : {}),
          ...(dated ? { endsAt: currentPeriodEnd } : {}),
        };
        break;
      }
      state = before(now, currentPeriodEnd, RENEWAL_LEEWAY_DAYS)
        ? {
            plan: tier,
            reason: 'subscribed',
            ...(currentPeriodEnd ? { endsAt: currentPeriodEnd } : {}),
          }
        : { plan: 'free', reason: 'lapsed' };
      break;
    case 'canceled':
      state = before(now, currentPeriodEnd)
        ? {
            plan: tier,
            reason: 'ending',
            ...(currentPeriodEnd ? { endsAt: currentPeriodEnd } : {}),
          }
        : { plan: 'free', reason: 'lapsed' };
      break;
    case 'paused':
    case 'expired':
      state = { plan: 'free', reason: 'lapsed' };
      break;
  }

  if (state.plan !== 'free' && !before(now, checkedAt, OFFLINE_GRACE_DAYS)) {
    return { plan: 'free', reason: 'stale' };
  }
  return state;
}

/** Jobs that count toward a plan's limit: anything not archived or in a `lost` stage. */
export function countActiveJobs(jobs: readonly Job[], stages: readonly Stage[]): number {
  return jobs.filter((job) => !job.archivedAt && findStage(stages, job.stageId)?.kind !== 'lost')
    .length;
}

/** Would restoring this job from the archive make it count as active again? */
export function countsAsActive(job: Job, stages: readonly Stage[]): boolean {
  return findStage(stages, job.stageId)?.kind !== 'lost';
}

export interface LimitCheck {
  allowed: boolean;
  active: number;
  limit: number;
}

/**
 * May `adding` more jobs be created on `plan`? Existing jobs are never
 * affected: after a downgrade every job stays, and only new ones are blocked
 * while the account is at or over its plan's limit.
 */
export function checkJobLimit(plan: Plan, active: number, adding = 1): LimitCheck {
  const limit = ACTIVE_JOB_LIMITS[plan];
  return { allowed: active + adding <= limit, active, limit };
}

/** The next plan up that holds more jobs, if any (for upgrade prompts). */
export function nextPlan(plan: Plan): PaidPlan | undefined {
  return plan === 'free' ? 'pro' : undefined;
}
