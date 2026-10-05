import {
  TRIAL_DAYS,
  activeJobsLabel,
  allows,
  FEATURES,
  SYNC_DEVICE_LIMITS,
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

  it('reads either server tier as Pro (ADR-0029)', () => {
    const adv = { tier: 'advanced' as const, currentPeriodEnd: days(10) };
    expect(planOf(ent({ ...adv, status: 'active' }), NOW).plan).toBe('pro');
    expect(planOf(ent({ ...adv, tier: 'pro', status: 'active' }), NOW).plan).toBe('pro');
    expect(planOf(ent({ ...adv, status: 'canceled' }), NOW)).toMatchObject({
      plan: 'pro',
      reason: 'ending',
    });
    expect(planOf(ent({ ...adv, status: 'active', currentPeriodEnd: days(-4) }), NOW).plan).toBe(
      'free',
    );
    expect(
      planOf(ent({ status: 'trialing', tier: 'advanced', trialEndsAt: days(14) }), NOW),
    ).toMatchObject({ plan: 'pro', reason: 'trial', trialDaysLeft: 14 });
    expect(planOf(ent({ status: 'trialing', trialEndsAt: days(3) }), NOW).plan).toBe('pro');
    expect(TRIAL_DAYS).toBe(14);
    // A stale snapshot drops to Free.
    expect(planOf(ent({ ...adv, status: 'active', checkedAt: days(-8) }), NOW)).toEqual({
      plan: 'free',
      reason: 'stale',
    });
  });

  it('shows a complimentary plan with no renewal date (ADR-0025)', () => {
    const comp = { status: 'active' as const, tier: 'advanced' as const, complimentary: true };
    expect(planOf(ent({ ...comp, currentPeriodEnd: '9999-12-31T00:00:00.000Z' }), NOW)).toEqual({
      plan: 'pro',
      reason: 'subscribed',
      complimentary: true,
    });
    // Ending a grant (status no longer active) behaves like any other plan.
    expect(
      planOf(ent({ ...comp, status: 'expired', currentPeriodEnd: '9999-12-31T00:00:00.000Z' }), NOW)
        .plan,
    ).toBe('free');
    // Still subject to the offline grace period.
    expect(
      planOf(
        ent({ ...comp, currentPeriodEnd: '9999-12-31T00:00:00.000Z', checkedAt: days(-8) }),
        NOW,
      ).reason,
    ).toBe('stale');
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

  it('holds 30 on Free; Pro is unlimited', () => {
    expect(ACTIVE_JOB_LIMITS).toEqual({ free: 30, pro: Infinity });
    expect(FREE_ACTIVE_JOB_LIMIT).toBe(30);
    expect(checkJobLimit('pro', 100_000, 500).allowed).toBe(true);
    expect(activeJobsLabel('free')).toBe('30 active jobs');
    expect(activeJobsLabel('pro')).toBe('Unlimited active jobs');
    expect(checkJobLimit('free', 29).allowed).toBe(true);
    expect(checkJobLimit('free', 30)).toEqual({ allowed: false, active: 30, limit: 30 });
    expect(checkJobLimit('free', 25, 6).allowed).toBe(false);
    // After a downgrade, an account over the limit keeps its jobs but can't add.
    expect(checkJobLimit('free', 60).allowed).toBe(false);
  });

  it('puts every paid feature on Pro (ADR-0029)', () => {
    for (const f of FEATURES) {
      expect(allows('free', f)).toBe(false);
      expect(allows('pro', f)).toBe(true);
    }
    // A build without accounts has nothing to upgrade to, so nothing is held back.
    expect(allows(undefined, 'emailUpdates')).toBe(true);
    expect(SYNC_DEVICE_LIMITS).toEqual({ free: 0, pro: 5 });
  });

  it('suggests the next plan up', () => {
    expect(nextPlan('free')).toBe('pro');
    expect(nextPlan('pro')).toBeUndefined();
  });
});
