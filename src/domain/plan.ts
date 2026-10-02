import { z } from 'zod';
import type { Job } from './job';
import { findStage, type Stage } from './stage';

/**
 * Free, Pro and Advanced (ADR-0009, ADR-0013). Pure rules only: where the
 * entitlement comes from (Supabase) and where limits are enforced
 * (JobService) live elsewhere.
 */

/** Plans, lowest first. Trials are of Advanced (since 2026-10-02; earlier ones were Pro). */
export const PLANS = ['free', 'pro', 'advanced'] as const;
export type Plan = (typeof PLANS)[number];
/** The paid plans a subscription can be on. */
export type PaidPlan = Exclude<Plan, 'free'>;
export const PAID_PLANS: readonly PaidPlan[] = ['pro', 'advanced'];

/**
 * Jobs outside a `lost` stage each plan may hold. Advanced has no limit; the
 * server's 5,000 synced-job cap (synced_jobs_cap) is the fair-use backstop.
 */
export const ACTIVE_JOB_LIMITS: Readonly<Record<Plan, number>> = {
  free: 15,
  pro: 60,
  advanced: Number.POSITIVE_INFINITY,
};

/**
 * Which plan each paid feature starts on (ADR-0013, 2026-10-02 revision):
 * Pro has everything that runs on your computer; Advanced adds what runs on
 * our servers (email updates, the web board and phone, more devices) and the
 * full side panel.
 */
export const FEATURE_PLANS = {
  history: 'pro',
  reminders: 'pro',
  customColumns: 'pro',
  pasteLink: 'pro',
  sync: 'pro',
  autofill: 'pro',
  insights: 'pro',
  records: 'pro',
  bulk: 'pro',
  emailUpdates: 'advanced',
  webBoard: 'advanced',
  fullSidePanel: 'advanced',
} as const satisfies Record<string, PaidPlan>;
export type Feature = keyof typeof FEATURE_PLANS;

/**
 * May this plan use the feature? `undefined` is a build without accounts,
 * where nothing is limited because there is no way to upgrade.
 */
export function allows(plan: Plan | undefined, feature: Feature): boolean {
  if (plan === undefined) return true;
  return PLANS.indexOf(plan) >= PLANS.indexOf(FEATURE_PLANS[feature]);
}

/** "Pro" or "Advanced": the plan to mention when pitching a feature. */
export function featurePlanName(feature: Feature): 'Pro' | 'Advanced' {
  return FEATURE_PLANS[feature] === 'pro' ? 'Pro' : 'Advanced';
}

/** "45 active jobs" or "Unlimited active jobs". */
export function activeJobsLabel(plan: Plan): string {
  const limit = ACTIVE_JOB_LIMITS[plan];
  return Number.isFinite(limit) ? `${String(limit)} active jobs` : 'Unlimited active jobs';
}
/**
 * Devices that may sync one account (ADR-0013 revision). Pro: computers only
 * (signed-in Chrome installs). Advanced: any device, including a phone through
 * the web board.
 */
export const SYNC_DEVICE_LIMITS: Readonly<Record<Plan, number>> = {
  free: 0,
  pro: 3,
  advanced: 5,
};
/** Only Advanced can use the web board (the way phones sync). */
export const WEB_BOARD_PLANS: readonly Plan[] = ['advanced'];
export const FREE_ACTIVE_JOB_LIMIT = ACTIVE_JOB_LIMITS.free;
export const TRIAL_DAYS = 14;
/** How long a cached Pro entitlement stays valid without reaching the server. */
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
  /** Which paid plan the trial or subscription is for. New trials are Advanced. */
  tier: z.enum(['pro', 'advanced']).default('pro'),
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
}

const before = (now: Date, iso: string | undefined, slackDays = 0) =>
  iso !== undefined && now.getTime() < Date.parse(iso) + slackDays * DAY_MS;

export function planOf(entitlement: Entitlement | undefined, now: Date): PlanState {
  if (!entitlement) return { plan: 'free', reason: 'no-account' };
  const { status, trialEndsAt, currentPeriodEnd, checkedAt } = entitlement;
  const tier = entitlement.tier;

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
  return plan === 'free' ? 'pro' : plan === 'pro' ? 'advanced' : undefined;
}
