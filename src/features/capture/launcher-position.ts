/**
 * Where the widget's button sits (ADR-0030): against the left or right edge,
 * at a height the user chose by dragging it. Stored as a fraction of the
 * window's height so it survives resizing. Pure, for the content script.
 */
export type LauncherSide = 'left' | 'right';
export interface LauncherPosition {
  side: LauncherSide;
  /** The button's top, as a fraction (0–1) of the window's height. */
  top: number;
}

export const LAUNCHER_POSITION_KEY = 'widget:position';
export const DEFAULT_LAUNCHER_POSITION: LauncherPosition = { side: 'right', top: 0.72 };
/** Gap kept between the button and the window's edges, in pixels. */
export const EDGE_GAP = 12;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A stored position, or the default for anything malformed. */
export function readPosition(value: unknown): LauncherPosition {
  const v = value as Partial<LauncherPosition> | null;
  if (
    !v ||
    (v.side !== 'left' && v.side !== 'right') ||
    typeof v.top !== 'number' ||
    !Number.isFinite(v.top)
  )
    return DEFAULT_LAUNCHER_POSITION;
  return { side: v.side, top: clamp(v.top, 0, 1) };
}

/** Where a button dropped with its centre at (x, y) settles: the nearer side, at that height. */
export function dropPosition(
  centre: { x: number; y: number },
  view: { width: number; height: number },
  size: number,
): LauncherPosition {
  const side: LauncherSide = centre.x < view.width / 2 ? 'left' : 'right';
  const top = view.height > 0 ? (centre.y - size / 2) / view.height : DEFAULT_LAUNCHER_POSITION.top;
  return { side, top: clamp(top, 0, 1) };
}

/** The button's pixel box for a position, kept fully inside the window. */
export function placeLauncher(
  position: LauncherPosition,
  view: { width: number; height: number },
  box: { width: number; height: number },
): { left: number; top: number } {
  const maxTop = Math.max(EDGE_GAP, view.height - box.height - EDGE_GAP);
  return {
    left:
      position.side === 'left' ? EDGE_GAP : Math.max(EDGE_GAP, view.width - box.width - EDGE_GAP),
    top: clamp(Math.round(position.top * view.height), EDGE_GAP, maxTop),
  };
}
