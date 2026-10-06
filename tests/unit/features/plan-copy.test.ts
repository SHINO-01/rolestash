import { planChip, planSummary } from '@/features/account/plan-copy';

describe('plan copy', () => {
  it('says a complimentary plan needs no subscription, with no renewal date', () => {
    const plan = {
      plan: 'pro' as const,
      reason: 'subscribed' as const,
      complimentary: true as const,
    };
    expect(planSummary(plan)).toBe('Pro, complimentary. No subscription needed.');
    expect(planChip(plan).label).toBe('Pro');
  });

  it('gives a dated grant its end date (ADR-0035)', () => {
    expect(
      planSummary({
        plan: 'pro',
        reason: 'subscribed',
        complimentary: true,
        endsAt: '2027-01-31T12:59:59.000Z',
      }),
    ).toMatch(/^Pro, complimentary until .+\. No subscription needed\.$/);
  });

  it('still gives subscribers their renewal date', () => {
    expect(
      planSummary({ plan: 'pro', reason: 'subscribed', endsAt: '2026-11-02T12:00:00.000Z' }),
    ).toMatch(/^Pro\. Renews on .+\.$/);
  });
});
