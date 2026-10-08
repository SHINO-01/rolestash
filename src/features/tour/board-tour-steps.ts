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
}

/** The steps for this person, in order. */
export function boardTourSteps(ctx: BoardTourContext): BoardTourStep[] {
  return BOARD_TOUR_STEPS.filter((step) => {
    switch (step) {
      case 'pin':
        return ctx.pinned !== true;
      // Dragging and opening need a card to practise on.
      case 'drag':
      case 'open-card':
      case 'card':
        return ctx.practice;
      case 'autofill':
        return ctx.autofill;
      case 'account':
        return ctx.accounts;
      default:
        return true;
    }
  });
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
  if (!practice) return false;
  if (step === 'drag') return startStageId !== undefined && practice.stageId !== startStageId;
  if (step === 'open-card') return openJobId === practice.id;
  return false;
}
