import {
  clearCheckoutIntent,
  parseCheckoutIntent,
  takeCheckoutIntent,
} from '@/web/checkout-intent';

describe('checkout intent from /pricing/ (ADR-0027)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    history.replaceState(null, '', '/board/');
  });

  it('parses only a paid plan and a billing interval', () => {
    expect(parseCheckoutIntent('pro-month')).toEqual({ tier: 'pro', interval: 'month' });
    expect(parseCheckoutIntent('advanced-quarter')).toEqual({
      tier: 'advanced',
      interval: 'quarter',
    });
    for (const bad of [null, '', 'free-month', 'pro', 'pro-week', 'pro-month-x', 'PRO-month'])
      expect(parseCheckoutIntent(bad), String(bad)).toBeNull();
  });

  it('moves the choice from the address bar into this tab, until cleared', () => {
    history.replaceState(null, '', '/board/?checkout=advanced-year&x=1#top');
    expect(takeCheckoutIntent()).toEqual({ tier: 'advanced', interval: 'year' });
    expect(location.search).toBe('?x=1');
    expect(location.hash).toBe('#top');
    // Survives a reload (or the Google sign-in round trip) in this tab.
    expect(takeCheckoutIntent()).toEqual({ tier: 'advanced', interval: 'year' });
    clearCheckoutIntent();
    expect(takeCheckoutIntent()).toBeNull();
  });

  it('drops a bad choice without replacing a good one', () => {
    history.replaceState(null, '', '/board/?checkout=pro-month');
    takeCheckoutIntent();
    history.replaceState(null, '', '/board/?checkout=nonsense');
    expect(takeCheckoutIntent()).toEqual({ tier: 'pro', interval: 'month' });
    expect(location.search).toBe('');
  });
});
