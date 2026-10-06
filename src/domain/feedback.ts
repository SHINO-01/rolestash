/**
 * Greeting people, asking for a store rating, and what a bug report carries
 * (ADR-0024). Pure rules; the services and UI decide when to call them.
 */

/** The Chrome Web Store item (the store build's extension ID). */
export const STORE_ITEM_ID = 'cncilbdakhabnocnjokbonggomndedgp';
export const STORE_URL = `https://chromewebstore.google.com/detail/rolestash/${STORE_ITEM_ID}`;
export const STORE_REVIEWS_URL = `${STORE_URL}/reviews`;

/** "Good morning, Sam": by the local hour, with the first name. */
export function greetingFor(firstName: string, at: Date): string {
  const hour = at.getHours();
  const part =
    hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 18 ? 'afternoon' : 'evening';
  return `Good ${part}, ${firstName}`;
}

// ── Asking for a rating ─────────────────────────────────────────────────────

/** Ask only once someone has really used Rolestash. */
export const RATING_MIN_JOBS = 10;
export const RATING_MIN_DAYS = 7;
/** "Not now" waits this long, and we ask at most this many times. */
export const RATING_SNOOZE_DAYS = 30;
export const RATING_MAX_ASKS = 3;

const DAY_MS = 24 * 3600_000;

export interface RatingPromptState {
  /** When this device first opened the board. */
  firstSeenAt?: string;
  /** How many times the prompt was shown. */
  asks: number;
  /** "Not now": not before this time. */
  snoozedUntil?: string;
  /** Rated, or "Don't ask again". Never ask again. */
  done?: boolean;
}

export const INITIAL_RATING_STATE: RatingPromptState = { asks: 0 };

export function shouldAskForRating(
  state: RatingPromptState,
  jobsSaved: number,
  now: Date,
): boolean {
  if (state.done || state.asks >= RATING_MAX_ASKS || jobsSaved < RATING_MIN_JOBS) return false;
  if (!state.firstSeenAt) return false;
  if (now.getTime() - Date.parse(state.firstSeenAt) < RATING_MIN_DAYS * DAY_MS) return false;
  return !state.snoozedUntil || now.getTime() >= Date.parse(state.snoozedUntil);
}

/** The state after the prompt is shown and answered. */
export function answerRating(
  state: RatingPromptState,
  answer: 'rate' | 'later' | 'never',
  now: Date,
): RatingPromptState {
  const asked = { ...state, asks: state.asks + 1 };
  if (answer === 'later')
    return {
      ...asked,
      snoozedUntil: new Date(now.getTime() + RATING_SNOOZE_DAYS * DAY_MS).toISOString(),
    };
  return { ...asked, done: true };
}

// ── Bug reports ─────────────────────────────────────────────────────────────

export const BUG_REPORT_MAX = 5000;

export type ReportPlace = 'board' | 'widget' | 'web board';

/** Everything a report may carry besides the message; shown to the person first. */
export interface ReportContext {
  version: string;
  browser: string;
  plan: string;
  where: ReportPlace;
  /** Only when they tick "Include this page's address". */
  page?: string;
}

/** The lines shown under "We'll also send", in the order they're sent. */
export function describeContext(context: ReportContext): [string, string][] {
  return [
    ['Rolestash version', context.version],
    ['Browser', context.browser],
    ['Plan', context.plan],
    ['Sent from', context.where],
    ...(context.page ? ([['Page', context.page]] as [string, string][]) : []),
  ];
}
