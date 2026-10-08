# ADR-0039: Teach the board with a guided tour on first run

- **Status:** Accepted
- **Date:** 2026-10-09

## Context

Rolestash has grown a lot of features: the Save job button on job sites, five
lanes, a card's details, manual jobs, search, Insights, History, bulk
selection, column editing, exports and backups, autofill, accounts with sync
and email updates. Most of them sit behind icons or the board's ⋯ menu. A new
install opened nothing, and on an empty board most of the header was hidden.
A new user should be able to find every feature without reading a help page.

Constraints (AGENTS.md): no third-party scripts or remote content, so no
hosted onboarding service; local-first, so nothing about the tour is sent
anywhere; the board must work offline.

## Decision

- **A tour on the board, ours, in React** (`src/ui/components/tour.tsx`). It
  spotlights one part of the page at a time, with a card that explains it.
  Steps that happen off the board (saving from a job site, pinning the icon)
  are centred cards with a small drawing.
- **It opens by itself the first time the board does** on this device, and
  never again once finished or skipped. `tour:board` in local storage records
  how it ended. **Help (?) → Take the tour** replays it. A new install opens the
  board (`runtime.onInstalled`, reason `install`), so the tour is the first
  thing people see.
- **Skip, Close and Esc end it at every step.** Back is there from step two.
  Arrow keys step through it while the card has focus. The rest of the page
  waits, except on the hands-on steps.
- **Hands-on steps use a practice card.** "Start the tour" adds a real job
  ("Practice job", "Rolestash tour") to the first lane. People drag it to the
  next lane and open it, and the tour moves on when they do. The card is
  removed when the tour ends, however it ends. Its id is kept in
  `tour:practiceJob`, so a tab closed mid-tour can't leave it behind: the next
  board load removes it. If the Free plan is full, the hands-on steps drop out.
- **The widget gets a three-step inline guide** the first time it shows a job
  (`tour:widget`). The widget's iframe is sized to its content, so a floating
  card would be clipped; the guide sits above the job and rings what it
  describes.
- **While a modal dialog is open** (the card drawer), the tour renders inside
  it, because a modal makes the rest of the page inert.
- **E2E builds don't open either guide by themselves**, because they would
  cover what tests click. A test opts in with `tour:e2eAutoStart`. The fixtures
  mark both as seen, so smoke and perf runs against the release build aren't
  covered either.

## Consequences

- New `data-tour` attributes mark what the tour points at (search, add-job,
  insights, history, select, account, help, board-menu, board, drawer), and cards
  carry `data-job-id`. Renaming or removing one of those elements means updating
  `src/features/tour/board-tour.tsx`. The E2E tour test catches a missing one.
- The tour's copy describes features. When a feature changes, its step must
  change with it.
- Creating and removing the practice card is an ordinary job write, so a
  signed-in replay syncs a short-lived job and its deletion.
- Existing users see the tour once after updating, because they have no
  `tour:board` record yet. That's intended, and Skip ends it.

## Alternatives considered

- **A tour library (Shepherd, Driver.js, Intro.js):** bundling one would be
  allowed, but each needed work for the drawer's top-layer dialog. The engine
  is about 400 lines and matches our tokens, dark mode and focus rules.
- **A video or a help page:** passive, and opening a page means a network
  request. People learn the board faster by trying it.
- **Sample data instead of one practice card:** a full fake board is harder to
  clean up and confusing to sync. One card covers dragging and opening.
- **Tooltips on every control:** they help for one button at a time and don't
  show how the parts fit together.
