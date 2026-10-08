/** Where a tour card goes beside its spotlight (see components/tour.tsx). Pure, for tests. */

export type TourPlacement = 'top' | 'bottom' | 'left' | 'right' | 'center';

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const GAP = 14;
const MARGIN = 16;

/**
 * Beside the target on the preferred side, else the opposite one, else
 * either other side. When none fits (a target as big as the window), the
 * card sits at the bottom of the window, over the target.
 */
export function placeCard(
  hole: Box | undefined,
  card: { width: number; height: number },
  preferred: TourPlacement,
  viewport: { width: number; height: number },
): { top: number; left: number } {
  const { width: vw, height: vh } = viewport;
  const clampLeft = (left: number) => Math.min(Math.max(left, MARGIN), vw - card.width - MARGIN);
  const clampTop = (top: number) => Math.min(Math.max(top, MARGIN), vh - card.height - MARGIN);
  if (!hole || preferred === 'center')
    return { top: clampTop((vh - card.height) / 2), left: clampLeft((vw - card.width) / 2) };

  const opposite: Record<Exclude<TourPlacement, 'center'>, Exclude<TourPlacement, 'center'>> = {
    top: 'bottom',
    bottom: 'top',
    left: 'right',
    right: 'left',
  };
  const order = [
    preferred,
    opposite[preferred],
    ...(['bottom', 'top', 'right', 'left'] as const).filter(
      (p) => p !== preferred && p !== opposite[preferred],
    ),
  ];
  const midX = hole.left + hole.width / 2 - card.width / 2;
  const midY = hole.top + hole.height / 2 - card.height / 2;
  for (const side of order) {
    if (side === 'bottom' && hole.top + hole.height + GAP + card.height <= vh - MARGIN)
      return { top: hole.top + hole.height + GAP, left: clampLeft(midX) };
    if (side === 'top' && hole.top - GAP - card.height >= MARGIN)
      return { top: hole.top - GAP - card.height, left: clampLeft(midX) };
    if (side === 'right' && hole.left + hole.width + GAP + card.width <= vw - MARGIN)
      return { top: clampTop(midY), left: hole.left + hole.width + GAP };
    if (side === 'left' && hole.left - GAP - card.width >= MARGIN)
      return { top: clampTop(midY), left: hole.left - GAP - card.width };
  }
  return { top: clampTop(vh - card.height - MARGIN * 2), left: clampLeft(vw - card.width - 24) };
}
