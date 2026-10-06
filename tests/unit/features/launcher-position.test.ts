import {
  DEFAULT_LAUNCHER_POSITION,
  dropPosition,
  EDGE_GAP,
  placeLauncher,
  readPosition,
} from '@/features/capture/launcher-position';

const view = { width: 1280, height: 800 };
const box = { width: 48, height: 48 };

describe('where the widget button sits (ADR-0030)', () => {
  it('snaps a dropped button to the nearer edge, at that height', () => {
    expect(dropPosition({ x: 200, y: 424 }, view, 48)).toEqual({ side: 'left', top: 0.5 });
    expect(dropPosition({ x: 900, y: 124 }, view, 48)).toEqual({ side: 'right', top: 0.125 });
    // Dragged off the window: kept inside it.
    expect(dropPosition({ x: -50, y: 2000 }, view, 48)).toEqual({ side: 'left', top: 1 });
  });

  it('places it fully inside the window, against its edge', () => {
    expect(placeLauncher({ side: 'left', top: 0.5 }, view, box)).toEqual({
      left: EDGE_GAP,
      top: 400,
    });
    expect(placeLauncher({ side: 'right', top: 0 }, view, box)).toEqual({
      left: 1280 - 48 - EDGE_GAP,
      top: EDGE_GAP,
    });
    // "Save job" is wider; it still ends at the right edge, and never below the window.
    expect(placeLauncher({ side: 'right', top: 1 }, view, { width: 120, height: 48 })).toEqual({
      left: 1280 - 120 - EDGE_GAP,
      top: 800 - 48 - EDGE_GAP,
    });
  });

  it('reads a stored position, falling back to the default', () => {
    expect(readPosition({ side: 'left', top: 0.3 })).toEqual({ side: 'left', top: 0.3 });
    expect(readPosition({ side: 'left', top: 7 })).toEqual({ side: 'left', top: 1 });
    for (const bad of [undefined, null, 'left', { side: 'top', top: 0.3 }, { side: 'left' }])
      expect(readPosition(bad)).toEqual(DEFAULT_LAUNCHER_POSITION);
  });
});
