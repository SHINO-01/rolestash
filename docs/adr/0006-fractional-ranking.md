# ADR-0006: Fractional ranking for card order

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

Cards are ordered within columns and reordered by drag-and-drop. Storing
positional indexes would rewrite every card below the drop point.

## Decision

Each job has a numeric `rank`. Moving a card sets its rank to the midpoint of
its new neighbours (`rankBetween`); new captures go to the top
(`min − 1024`). When the gap between neighbours drops below `1e-6`, the column
is rebalanced to evenly spaced ranks (`evenRanks`) in one batched write.

## Consequences

- A move writes one record in the common case.
- Rebalancing is rare and bounded by column size.
- Filtered views must translate visual positions into positions among all jobs
  (`resolveDropIndex`).

## Alternatives considered

- **Array of ids per column in settings:** single hot key contended by every write.
- **String-based lexorank:** unbounded precision, more complexity than needed at board scale.
