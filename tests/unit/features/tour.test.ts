import {
  autoStartAllowed,
  BOARD_TOUR_STEPS,
  boardTourSteps,
  E2E_AUTO_START_KEY,
  firstAppearance,
  GUIDE_TOPICS,
  guideSteps,
  guideTopics,
  needsPractice,
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
    // Dragging is only ever practised on the practice card.
    expect(practiceTaskDone('drag', undefined, 'saved', 'p')).toBe(false);
    // Opening any card counts: a full Free board has no practice card.
    expect(practiceTaskDone('open-card', practice, 'saved', undefined)).toBe(false);
    expect(practiceTaskDone('open-card', practice, 'saved', 'p')).toBe(true);
    expect(practiceTaskDone('open-card', undefined, undefined, 'own')).toBe(true);
    expect(practiceTaskDone('lanes', practice, 'saved', 'p')).toBe(false);
  });

  it('opens on an empty board, and only offers itself on a board with jobs', () => {
    expect(firstAppearance(undefined, 0)).toBe('tour');
    expect(firstAppearance(undefined, 120)).toBe('invite');
    expect(firstAppearance({ status: 'skipped', at: 'x', step: 'invite' }, 120)).toBe('none');
    expect(firstAppearance({ status: 'finished', at: 'x' }, 0)).toBe('none');
  });

  it('shows "open a card" on one of their own when a full Free board has no room', () => {
    const full = { ...EVERYTHING, practice: false, ownJob: true };
    const steps = boardTourSteps(full);
    expect(steps).not.toContain('drag');
    expect(steps).toContain('open-card');
    expect(steps).toContain('card');
  });
});

describe('Help → How do I…? guides (ADR-0039)', () => {
  it('has a topic for every feature step of the tour', () => {
    const covered = new Set<string>(Object.values(GUIDE_TOPICS).flat());
    for (const step of BOARD_TOUR_STEPS)
      if (!['welcome', 'help', 'done'].includes(step)) expect(covered).toContain(step);
  });

  it('runs only the topic’s own steps', () => {
    expect(guideSteps('search', EVERYTHING)).toEqual(['search']);
    expect(guideSteps('move', EVERYTHING)).toEqual(['lanes', 'drag']);
    expect(guideSteps('details', EVERYTHING)).toEqual(['open-card', 'card']);
    expect(guideSteps('save', { ...EVERYTHING, pinned: true })).toEqual(['capture']);
  });

  it('still explains the lanes when there is no room for a practice card', () => {
    expect(guideSteps('move', { ...EVERYTHING, practice: false })).toEqual(['lanes']);
  });

  it('lists autofill and accounts only in builds that have them', () => {
    expect(guideTopics({ accounts: true, autofill: true })).toContain('account');
    const bare = guideTopics({ accounts: false, autofill: false });
    expect(bare).not.toContain('account');
    expect(bare).not.toContain('autofill');
    expect(bare).toContain('move');
  });

  it('adds a practice card only for topics with hands-on steps', () => {
    expect(needsPractice(guideSteps('move', EVERYTHING))).toBe(true);
    expect(needsPractice(guideSteps('details', EVERYTHING))).toBe(true);
    expect(needsPractice(guideSteps('search', EVERYTHING))).toBe(false);
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
