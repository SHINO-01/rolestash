/**
 * Fractional ranking for ordering cards within a column (ADR-0006).
 *
 * Moving a card writes exactly one record: its new rank is the midpoint of its
 * neighbours. When neighbours get too close for floating-point precision we
 * rebalance the whole column, which is rare and cheap at board scale.
 */

export const RANK_STEP = 1024;
const MIN_GAP = 1e-6;

export function rankBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined) return after === undefined ? RANK_STEP : after - RANK_STEP;
  if (after === undefined) return before + RANK_STEP;
  return before + (after - before) / 2;
}

/** True when a rank can no longer be placed safely between its neighbours. */
export function needsRebalance(before: number | undefined, after: number | undefined): boolean {
  return before !== undefined && after !== undefined && after - before < MIN_GAP;
}

/** Evenly spaced ranks for `count` items, preserving order. */
export function evenRanks(count: number): number[] {
  return Array.from({ length: count }, (_, i) => (i + 1) * RANK_STEP);
}
