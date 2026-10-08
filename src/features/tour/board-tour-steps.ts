import type { Job, Posting } from '@/domain/job';

/**
 * The board's product tour (ADR-0039): which steps a person sees, and
 * whether it should open by itself. Pure; board-tour.tsx draws it.
 */

/** How the board tour ended on this device; absent until it has run once. */
export const BOARD_TOUR_KEY = 'tour:board';
/** The practice card's id while a tour is running, so a closed tab can't leave it behind. */
export const PRACTICE_JOB_KEY = 'tour:practiceJob';
/** The widget's first-run guide: shown once, then this is set. */
export const WIDGET_GUIDE_KEY = 'tour:widget';
/**
 * E2E builds start every test on a fresh profile, so neither guide opens by
 * itself there unless a test sets this (it would cover what the test clicks).
 */
export const E2E_AUTO_START_KEY = 'tour:e2eAutoStart';

/** Whether the guides may open by themselves in this build. */
export function autoStartAllowed(mode: string, stored: Record<string, unknown>): boolean {
  return mode !== 'e2e' || stored[E2E_AUTO_START_KEY] === true;
}

export const BOARD_TOUR_STEPS = [
  'welcome',
  'capture',
  'pin',
  'lanes',
  'drag',
  'open-card',
  'card',
  'add',
  'search',
  'insights',
  'history',
  'select',
  'menu',
  'autofill',
  'account',
  'help',
  'done',
] as const;
export type BoardTourStep = (typeof BOARD_TOUR_STEPS)[number];

export interface BoardTourContext {
  /** The build has accounts (sign-in, sync, Pro). */
  accounts: boolean;
  /** Autofill is available in this build. */
  autofill: boolean;
  /** The toolbar icon is pinned; undefined when Chrome can't say. */
  pinned: boolean | undefined;
  /** A practice card is (or will be) on the board for the hands-on steps. */
  practice: boolean;
  /**
   * The board has one of the person's own jobs. Without a practice card
   * (a full Free board), opening a card is shown on one of theirs, which
   * changes nothing. Dragging is only ever practised on the practice card.
   */
  ownJob?: boolean;
}

function applies(step: BoardTourStep, ctx: BoardTourContext): boolean {
  switch (step) {
    case 'pin':
      return ctx.pinned !== true;
    case 'drag':
      return ctx.practice;
    case 'open-card':
    case 'card':
      return ctx.practice || ctx.ownJob === true;
    case 'autofill':
      return ctx.autofill;
    case 'account':
      return ctx.accounts;
    default:
      return true;
  }
}

/** The full tour's steps for this person, in order. */
export function boardTourSteps(ctx: BoardTourContext): BoardTourStep[] {
  return BOARD_TOUR_STEPS.filter((step) => applies(step, ctx));
}

/**
 * Help → How do I…?: one feature at a time, for when someone has forgotten
 * how something works. Each topic is a short guide made of the tour's own
 * steps, shown on the person's board.
 */
export const GUIDE_TOPICS = {
  save: ['capture', 'pin'],
  move: ['lanes', 'drag'],
  details: ['open-card', 'card'],
  add: ['add'],
  search: ['search'],
  insights: ['insights'],
  history: ['history'],
  select: ['select'],
  menu: ['menu'],
  autofill: ['autofill'],
  account: ['account'],
} as const satisfies Record<string, readonly BoardTourStep[]>;
export type GuideTopic = keyof typeof GUIDE_TOPICS;

/** A topic's steps for this person; empty when the topic doesn't apply to this build. */
export function guideSteps(topic: GuideTopic, ctx: BoardTourContext): BoardTourStep[] {
  const steps: readonly BoardTourStep[] = GUIDE_TOPICS[topic];
  // Without a practice card, "Move a job" still explains the lanes.
  return steps.filter((step) => applies(step, ctx));
}

/** The topics this build has (no autofill or accounts, no topic for them). */
export function guideTopics(ctx: Pick<BoardTourContext, 'accounts' | 'autofill'>): GuideTopic[] {
  return (Object.keys(GUIDE_TOPICS) as GuideTopic[]).filter(
    (topic) => (topic !== 'autofill' || ctx.autofill) && (topic !== 'account' || ctx.accounts),
  );
}

/** Whether a set of steps needs the practice card. */
export function needsPractice(steps: readonly BoardTourStep[]): boolean {
  return steps.some((step) => step === 'drag' || step === 'open-card' || step === 'card');
}

export interface TourRecord {
  status: 'finished' | 'skipped';
  at: string;
  /** The step it was closed on, when skipped. */
  step?: string;
}

export function readTourRecord(value: unknown): TourRecord | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { status, at, step } = value as Record<string, unknown>;
  if ((status !== 'finished' && status !== 'skipped') || typeof at !== 'string') return undefined;
  return { status, at, ...(typeof step === 'string' ? { step } : {}) };
}

/** The tour opens by itself until it has been finished or skipped once on this device. */
export function shouldAutoStart(record: TourRecord | undefined): boolean {
  return record === undefined;
}

/**
 * How the tour first appears. On an empty board, the tour itself: there is
 * nothing else to do yet. For someone who already has jobs (an update, not
 * an install) the tour is only offered, in a corner card that leaves the
 * board usable: they came to work, not to be taught.
 */
export function firstAppearance(
  record: TourRecord | undefined,
  ownJobs: number,
): 'tour' | 'invite' | 'none' {
  if (!shouldAutoStart(record)) return 'none';
  return ownJobs > 0 ? 'invite' : 'tour';
}

/** The card the tour adds for practice, and removes when it ends. */
export const PRACTICE_POSTING: Posting = {
  title: 'Practice job',
  company: 'Rolestash tour',
  location: 'Anywhere',
  workplaceType: 'remote',
  employmentTypes: [],
};

/** Whether a hands-on step's task is done. */
export function practiceTaskDone(
  step: BoardTourStep,
  practice: Job | undefined,
  startStageId: string | undefined,
  openJobId: string | undefined,
): boolean {
  // Any card will do for opening: on a full Free board there is no practice card.
  if (step === 'open-card') return openJobId !== undefined;
  if (step === 'drag')
    return (
      practice !== undefined && startStageId !== undefined && practice.stageId !== startStageId
    );
  return false;
}
