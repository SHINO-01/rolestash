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
- **It opens by itself the first time an empty board does** on this device,
  and never again once finished or skipped. `tour:board` in local storage
  records how it ended. A new install opens the board (`runtime.onInstalled`,
  reason `install`), so the tour is the first thing people see.
- **A board that already has jobs is only offered the tour.** Someone updating
  with a full board came to work, so a corner card ("New: a tour of everything
  Rolestash does") leaves the board usable. Take the tour starts it. Not now and
  ✕ record it as skipped (`step: "invite"`), so the card doesn't come back.
- **Help (?) has the full tour and a guide to any one feature.** **How do I…?**
  is a searchable list of topics (save a job, move a job, a card's details, add
  a job, search, Insights, History, select, the menu, autofill, accounts).
  Each topic runs that feature's tour steps on the person's own board, with the
  practice card when it has hands-on steps. Topics don't touch `tour:board`.
  This is for anyone who has forgotten how something works, however long
  they've used Rolestash.
- **Skip, Close and Esc end it at every step.** Back is there from step two.
  Arrow keys step through it while the card has focus. The rest of the page
  waits, except on the hands-on steps.
- **Hands-on steps use a practice card.** "Start the tour" adds a real job
  ("Practice job", "Rolestash tour") to the top of the first lane, and a ring
  marks it among the person's own cards. People drag it to the next lane and
  open it, and the tour moves on when they do. The card is removed when the
  tour ends, however it ends. Its id is kept in `tour:practiceJob`, so a tab
  closed mid-tour can't leave it behind: the next board load removes it.
  Nothing else on the board changes. Before starting, the tour clears search
  and selection and closes dialogs, so nothing hides the card.
- **A full Free board has no room for a practice card.** The plan limit is
  checked before step one. Dragging drops out, the copy doesn't promise a card,
  and opening a card is shown on one of the person's own, which changes
  nothing.
- **Pages that aren't job postings say so.** Clicking the icon on, say, a news
  article used to open a job form titled after the article. Now the widget
  says "This doesn't look like a job posting", points to job sites and the
  board, and keeps "It is a job: save this page". This was where a new user
  got lost.
- **The widget gets a three-step inline guide** the first time it shows a job
  to someone with no saved jobs yet (`tour:widget`). The widget's iframe is sized to its content, so a floating
  card would be clipped; the guide sits above the job and rings what it
  describes.
- **While a modal dialog is open** (the card drawer), the tour renders inside
  it, because a modal makes the rest of the page inert.
- **Motion:** one animation-frame loop places the spotlight, rings and card
  directly on the DOM (no React render per frame). A new step glides for
  320 ms with an ease-out, then everything tracks its target exactly, so a
  scroll or a sliding drawer never makes it lag. The pulse on "Try it" steps
  is a ring scaling and fading (transform and opacity); nothing animates the
  dimming shadow, which would repaint the whole window each frame. Reduced
  motion jumps instead of gliding.
- **Drawers slide their panel, not the `<dialog>`:** a transformed dialog
  becomes the frame for anything fixed inside it, so the tour's layer would
  shift and clip while it slid. The tour follows a dialog opening or
  closing at once (a MutationObserver and `flushSync`), redrawing in place
  before the browser paints.
- **E2E builds don't open either guide by themselves**, because they would
  cover what tests click. A test opts in with `tour:e2eAutoStart`. The fixtures
  mark both as seen, so smoke and perf runs against the release build aren't
  covered either.

- **Accessible by default.** Steps that only explain are modal: Tab stays in
  the card, and the page behind takes no clicks. "Try it" steps let the
  keyboard out, and their **Go to the card** button focuses the card. Dragging
  has a keyboard way (Space, arrows, Space) and a single-pointer way (open the
  card and pick its lane). The card's title takes focus on each step. Progress
  is text ("3 of 17"), and a finished task is announced. Motion stops under
  reduced motion. The board has a skip link, and menus say they open a menu.

## Consequences

- New `data-tour` attributes mark what the tour points at (search, add-job,
  insights, history, select, account, help, board-menu, board, drawer), and cards
  carry `data-job-id`. Renaming or removing one of those elements means updating
  `src/features/tour/board-tour.tsx`. The E2E tour test catches a missing one.
- The tour's copy describes features. When a feature changes, its step must
  change with it.
- Existing users see the corner card once after updating, because they have
  no `tour:board` record yet. That's intended, and Not now ends it.
- A signed-in replay syncs the practice card to other devices for the length
  of the tour, then its deletion.

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
