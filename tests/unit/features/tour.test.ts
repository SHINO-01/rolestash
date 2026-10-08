import {
  autoStartAllowed,
  BOARD_TOUR_STEPS,
  boardTourSteps,
  E2E_AUTO_START_KEY,
  practiceTaskDone,
  readTourRecord,
  shouldAutoStart,
} from '@/features/tour/board-tour-steps';
import { placeCard } from '@/ui/tour-placement';
import { makeJob } from '../helpers/factories';

const EVERYTHING = { accounts: true, autofill: true, pinned: false, practice: true };

describe('the board tour (ADR-0039)', () => {
  it('walks every feature when everything applies', () => {
    expect(boardTourSteps(EVERYTHING)).toEqual([...BOARD_TOUR_STEPS]);
    // Welcome first, done last: the card's Start and Finish buttons rely on it.
    expect(BOARD_TOUR_STEPS[0]).toBe('welcome');
    expect(BOARD_TOUR_STEPS.at(-1)).toBe('done');
  });

  it('leaves out what does not apply', () => {
    const steps = boardTourSteps({
      accounts: false,
      autofill: false,
      pinned: true,
      practice: false,
    });
    for (const gone of ['pin', 'drag', 'open-card', 'card', 'autofill', 'account'])
      expect(steps).not.toContain(gone);
    expect(steps).toContain('lanes');
    expect(steps).toContain('help');
  });

  it('asks to pin when Chrome cannot say whether the icon is pinned', () => {
    expect(boardTourSteps({ ...EVERYTHING, pinned: undefined })).toContain('pin');
  });

  it('opens by itself until it has been finished or skipped once', () => {
    expect(shouldAutoStart(undefined)).toBe(true);
    expect(shouldAutoStart({ status: 'skipped', at: '2026-10-09T00:00:00Z' })).toBe(false);
    expect(shouldAutoStart({ status: 'finished', at: '2026-10-09T00:00:00Z' })).toBe(false);
  });

  it('reads only well-formed records', () => {
    expect(readTourRecord(undefined)).toBeUndefined();
    expect(readTourRecord('done')).toBeUndefined();
    expect(readTourRecord({ status: 'maybe', at: 'x' })).toBeUndefined();
    expect(readTourRecord({ status: 'skipped', at: '2026-10-09T00:00:00Z', step: 'drag' })).toEqual(
      { status: 'skipped', at: '2026-10-09T00:00:00Z', step: 'drag' },
    );
  });

  it('never opens by itself in E2E builds unless a test asks', () => {
    expect(autoStartAllowed('production', {})).toBe(true);
    expect(autoStartAllowed('e2e', {})).toBe(false);
    expect(autoStartAllowed('e2e', { [E2E_AUTO_START_KEY]: true })).toBe(true);
  });

  it('knows when the hands-on tasks are done', () => {
    const practice = makeJob({ id: 'p', stageId: 'saved' });
    expect(practiceTaskDone('drag', practice, 'saved', undefined)).toBe(false);
    expect(practiceTaskDone('drag', { ...practice, stageId: 'applied' }, 'saved', undefined)).toBe(
      true,
    );
    expect(practiceTaskDone('open-card', practice, 'saved', undefined)).toBe(false);
    expect(practiceTaskDone('open-card', practice, 'saved', 'p')).toBe(true);
    expect(practiceTaskDone('open-card', practice, 'saved', 'other')).toBe(false);
    expect(practiceTaskDone('drag', undefined, 'saved', 'p')).toBe(false);
    expect(practiceTaskDone('lanes', practice, 'saved', 'p')).toBe(false);
  });
});

describe('placing the tour card', () => {
  const viewport = { width: 1280, height: 800 };
  const card = { width: 360, height: 240 };

  it('centres the card without a target', () => {
    expect(placeCard(undefined, card, 'bottom', viewport)).toEqual({ top: 280, left: 460 });
  });

  it('goes below a target near the top, centred on it', () => {
    const add = { top: 10, left: 1100, width: 110, height: 40 };
    // Centred under the button, then kept 16px inside the window.
    expect(placeCard(add, card, 'bottom', viewport)).toEqual({ top: 64, left: 904 });
  });

  it('flips to the other side when the preferred one has no room', () => {
    const low = { top: 700, left: 400, width: 100, height: 60 };
    expect(placeCard(low, card, 'bottom', viewport).top).toBe(700 - 14 - 240);
    const left = { top: 300, left: 10, width: 200, height: 100 };
    expect(placeCard(left, card, 'left', viewport).left).toBe(10 + 200 + 14);
  });

  it('sits at the bottom of the window over a target as big as the window', () => {
    const board = { top: 0, left: 0, width: 1280, height: 800 };
    expect(placeCard(board, card, 'bottom', viewport)).toEqual({ top: 528, left: 896 });
  });
});
