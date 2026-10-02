import {
  activeJobsLabel,
  allows,
  featurePlanName,
  ACTIVE_JOB_LIMITS,
  checkJobLimit,
  nextPlan,
  countActiveJobs,
  FREE_ACTIVE_JOB_LIMIT,
  planOf,
  type Entitlement,
} from '@/domain/plan';
import { DEFAULT_STAGES } from '@/domain/stage';
import { makeJob } from '../helpers/factories';

const NOW = new Date('2026-10-15T00:00:00.000Z');
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();
const ent = (e: Partial<Entitlement>): Entitlement => ({
  status: 'trialing',
  tier: 'pro',
  checkedAt: days(0),
  ...e,
});

describe('planOf', () => {
  it('is Free without an account', () => {
    expect(planOf(undefined, NOW)).toEqual({ plan: 'free', reason: 'no-account' });
  });

  it('is Pro during the trial, with days left rounded up', () => {
    expect(planOf(ent({ trialEndsAt: days(29.2) }), NOW)).toEqual({
      plan: 'pro',
      reason: 'trial',
      endsAt: days(29.2),
      trialDaysLeft: 30,
    });
  });

  it('drops to Free when the trial ends', () => {
    expect(planOf(ent({ trialEndsAt: days(-0.01) }), NOW)).toEqual({
      plan: 'free',
      reason: 'trial-ended',
    });
    expect(planOf(ent({}), NOW).plan).toBe('free');
  });

  it('keeps paying and past-due subscribers on Pro, with renewal leeway', () => {
    for (const status of ['active', 'past_due'] as const) {
      expect(planOf(ent({ status, currentPeriodEnd: days(10) }), NOW).reason).toBe('subscribed');
      expect(planOf(ent({ status, currentPeriodEnd: days(-2) }), NOW).plan).toBe('pro');
      expect(planOf(ent({ status, currentPeriodEnd: days(-4) }), NOW)).toEqual({
        plan: 'free',
        reason: 'lapsed',
      });
    }
  });

  it('honours the paid period after a cancel, then lapses', () => {
    expect(planOf(ent({ status: 'canceled', currentPeriodEnd: days(5) }), NOW)).toEqual({
      plan: 'pro',
      reason: 'ending',
      endsAt: days(5),
    });
    expect(planOf(ent({ status: 'canceled', currentPeriodEnd: days(-1) }), NOW).reason).toBe(
      'lapsed',
    );
  });

  it('follows the subscription tier, and trials are always Pro', () => {
    const adv = { tier: 'advanced' as const, currentPeriodEnd: days(10) };
    expect(planOf(ent({ ...adv, status: 'active' }), NOW).plan).toBe('advanced');
    expect(planOf(ent({ ...adv, status: 'canceled' }), NOW)).toMatchObject({
      plan: 'advanced',
      reason: 'ending',
    });
    expect(planOf(ent({ ...adv, status: 'active', currentPeriodEnd: days(-4) }), NOW).plan).toBe(
      'free',
    );
    expect(planOf(ent({ status: 'trialing', trialEndsAt: days(3) }), NOW).plan).toBe('pro');
    // A stale Advanced snapshot drops to Free too, not to Pro.
    expect(planOf(ent({ ...adv, status: 'active', checkedAt: days(-8) }), NOW)).toEqual({
      plan: 'free',
      reason: 'stale',
    });
  });

  it('treats paused and expired as Free', () => {
    expect(planOf(ent({ status: 'paused', currentPeriodEnd: days(5) }), NOW).plan).toBe('free');
    expect(planOf(ent({ status: 'expired' }), NOW).plan).toBe('free');
  });

  it('stops trusting a Pro snapshot not confirmed for over the grace period', () => {
    const active = { status: 'active' as const, currentPeriodEnd: days(20) };
    expect(planOf(ent({ ...active, checkedAt: days(-6.9) }), NOW).plan).toBe('pro');
    expect(planOf(ent({ ...active, checkedAt: days(-7.1) }), NOW)).toEqual({
      plan: 'free',
      reason: 'stale',
    });
  });
});

describe('free-plan job limit', () => {
  it('counts every job not in a lost stage', () => {
    const jobs = [
      makeJob({ stageId: 'saved' }),
      makeJob({ stageId: 'offer' }),
      makeJob({ stageId: 'rejected' }),
      makeJob({ stageId: 'withdrawn' }),
      makeJob({ stageId: 'deleted-custom-stage' }),
    ];
    expect(countActiveJobs(jobs, DEFAULT_STAGES)).toBe(3);
  });

  it('holds 15 on Free and 60 on Pro; Advanced is unlimited', () => {
    expect(ACTIVE_JOB_LIMITS).toEqual({ free: 15, pro: 60, advanced: Infinity });
    expect(FREE_ACTIVE_JOB_LIMIT).toBe(15);
    expect(checkJobLimit('advanced', 100_000, 500).allowed).toBe(true);
    expect(activeJobsLabel('pro')).toBe('60 active jobs');
    expect(activeJobsLabel('advanced')).toBe('Unlimited active jobs');
    for (const [plan, limit] of (
      Object.entries(ACTIVE_JOB_LIMITS) as [keyof typeof ACTIVE_JOB_LIMITS, number][]
    ).filter(([, l]) => Number.isFinite(l))) {
      expect(checkJobLimit(plan, limit - 1).allowed).toBe(true);
      expect(checkJobLimit(plan, limit)).toEqual({ allowed: false, active: limit, limit });
    }
    expect(checkJobLimit('free', 10, 6).allowed).toBe(false);
    // After a downgrade, an account over the limit keeps its jobs but can't add.
    expect(checkJobLimit('free', 60).allowed).toBe(false);
  });

  it('puts on-device features on Pro and server features on Advanced', () => {
    for (const f of ['autofill', 'insights', 'records', 'bulk', 'sync', 'reminders'] as const) {
      expect(allows('free', f)).toBe(false);
      expect(allows('pro', f)).toBe(true);
      expect(allows('advanced', f)).toBe(true);
    }
    for (const f of ['emailUpdates', 'webBoard', 'fullSidePanel'] as const) {
      expect(allows('pro', f)).toBe(false);
      expect(allows('advanced', f)).toBe(true);
    }
    // A build without accounts has nothing to upgrade to, so nothing is held back.
    expect(allows(undefined, 'emailUpdates')).toBe(true);
    expect(featurePlanName('autofill')).toBe('Pro');
  });

  it('suggests the next plan up', () => {
    expect(nextPlan('free')).toBe('pro');
    expect(nextPlan('pro')).toBe('advanced');
    expect(nextPlan('advanced')).toBeUndefined();
  });
});
