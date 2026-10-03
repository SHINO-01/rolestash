import {
  answerRating,
  describeContext,
  greetingFor,
  INITIAL_RATING_STATE,
  RATING_MAX_ASKS,
  shouldAskForRating,
  STORE_REVIEWS_URL,
} from '@/domain/feedback';

const at = (iso: string) => new Date(iso);
const DAY = 24 * 3600_000;

describe('greeting', () => {
  it('says good morning, afternoon or evening by the local hour', () => {
    const local = (h: number) => new Date(2026, 9, 4, h, 30);
    expect(greetingFor('Sam', local(7))).toBe('Good morning, Sam');
    expect(greetingFor('Sam', local(13))).toBe('Good afternoon, Sam');
    expect(greetingFor('Sam', local(19))).toBe('Good evening, Sam');
    expect(greetingFor('Sam', local(2))).toBe('Good evening, Sam');
  });
});

describe('asking for a rating', () => {
  const start = '2026-10-01T00:00:00.000Z';
  const seen = { ...INITIAL_RATING_STATE, firstSeenAt: start };
  const after = (days: number) => new Date(Date.parse(start) + days * DAY);

  it('waits for real use: 10 jobs and a week', () => {
    expect(shouldAskForRating(seen, 9, after(30))).toBe(false);
    expect(shouldAskForRating(seen, 10, after(6))).toBe(false);
    expect(shouldAskForRating(seen, 10, after(7))).toBe(true);
    expect(shouldAskForRating(INITIAL_RATING_STATE, 50, after(30))).toBe(false);
  });

  it('"Not now" waits 30 days, and it asks at most three times', () => {
    let state = answerRating(seen, 'later', after(7));
    expect(shouldAskForRating(state, 10, after(20))).toBe(false);
    expect(shouldAskForRating(state, 10, after(38))).toBe(true);
    for (let i = 1; i < RATING_MAX_ASKS; i++) state = answerRating(state, 'later', after(40 * i));
    expect(state.asks).toBe(RATING_MAX_ASKS);
    expect(shouldAskForRating(state, 10, after(400))).toBe(false);
  });

  it('never asks again after rating or "Don’t ask again"', () => {
    expect(shouldAskForRating(answerRating(seen, 'rate', after(8)), 99, after(999))).toBe(false);
    expect(shouldAskForRating(answerRating(seen, 'never', after(8)), 99, after(999))).toBe(false);
    expect(STORE_REVIEWS_URL).toMatch(
      /^https:\/\/chromewebstore\.google\.com\/detail\/rolestash\/[a-p]{32}\/reviews$/,
    );
    expect(at(start).getTime()).toBeGreaterThan(0);
  });
});

describe('bug report details', () => {
  it('lists exactly what is sent, with the page only when included', () => {
    const base = {
      version: '0.4.1',
      browser: 'Chrome on macOS',
      plan: 'pro',
      where: 'popup' as const,
    };
    expect(describeContext(base).map(([k]) => k)).toEqual([
      'Rolestash version',
      'Browser',
      'Plan',
      'Sent from',
    ]);
    expect(describeContext({ ...base, page: 'https://jobs.example/1' }).at(-1)).toEqual([
      'Page',
      'https://jobs.example/1',
    ]);
  });
});
