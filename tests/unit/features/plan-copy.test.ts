import { planChip, planSummary } from '@/features/account/plan-copy';

describe('plan copy', () => {
  it('says a complimentary plan needs no subscription, with no renewal date', () => {
    const plan = {
      plan: 'advanced' as const,
      reason: 'subscribed' as const,
      complimentary: true as const,
    };
    expect(planSummary(plan)).toBe('Advanced, complimentary. No subscription needed.');
    expect(planChip(plan).label).toBe('Advanced');
  });

  it('still gives subscribers their renewal date', () => {
    expect(
      planSummary({ plan: 'pro', reason: 'subscribed', endsAt: '2026-11-02T12:00:00.000Z' }),
    ).toMatch(/^Pro\. Renews on .+\.$/);
  });
});
