import {
  clearCheckoutIntent,
  parseCheckoutIntent,
  parsePromo,
  savePromo,
  takeCheckoutIntent,
  takePromo,
} from '@/web/checkout-intent';

describe('checkout intent from /pricing/ (ADR-0027)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    history.replaceState(null, '', '/board/');
  });

  it('parses only a paid plan and a billing interval', () => {
    expect(parseCheckoutIntent('pro-month')).toEqual({ tier: 'pro', interval: 'month' });
    // Links from before the plans merged (ADR-0029) buy Pro.
    expect(parseCheckoutIntent('advanced-quarter')).toEqual({ tier: 'pro', interval: 'quarter' });
    for (const bad of [null, '', 'free-month', 'pro', 'pro-week', 'pro-month-x', 'PRO-month'])
      expect(parseCheckoutIntent(bad), String(bad)).toBeNull();
  });

  it('moves the choice from the address bar into this tab, until cleared', () => {
    history.replaceState(null, '', '/board/?checkout=pro-year&x=1#top');
    expect(takeCheckoutIntent()).toEqual({ tier: 'pro', interval: 'year' });
    expect(location.search).toBe('?x=1');
    expect(location.hash).toBe('#top');
    // Survives a reload (or the Google sign-in round trip) in this tab.
    expect(takeCheckoutIntent()).toEqual({ tier: 'pro', interval: 'year' });
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

  it('takes a promo code and referral from the link or the pricing page, safely (ADR-0035)', () => {
    expect(parsePromo({ code: ' launch30 ', ref: 'k7q2m9xa' })).toEqual({
      code: 'LAUNCH30',
      ref: 'K7Q2M9XA',
    });
    expect(parsePromo({ code: '<b>', ref: 42 })).toEqual({});
    expect(parsePromo(null)).toEqual({});

    sessionStorage.setItem('rolestash:promo', JSON.stringify({ ref: 'K7Q2M9XA' }));
    history.replaceState(null, '', '/board/?checkout=pro-month&code=spring&x=1');
    expect(takePromo()).toEqual({ ref: 'K7Q2M9XA', code: 'SPRING' });
    expect(location.search).toBe('?checkout=pro-month&x=1');
    expect(takePromo()).toEqual({ ref: 'K7Q2M9XA', code: 'SPRING' });
    savePromo({});
    expect(takePromo()).toEqual({});
  });
});
