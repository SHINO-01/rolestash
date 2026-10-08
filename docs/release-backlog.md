# Release backlog (Chrome Web Store)

Extension releases waiting their turn. The store reviews one submission at a
time: submitting a new version while one is in review means cancelling that
review and starting again at the back of the queue. So releases go out
**one at a time, in this order**, each after the previous one is approved.

How a release ships: [releasing.md](guides/releasing.md). Changes that need
no store review (the website, the web board, Edge Functions, the database,
the operations dashboard) go live when CI deploys them and are not listed
here, except where a release depends on them.

_Last updated 9 October 2026._

## Live

**0.6.1** (five lanes, Rejected back as a lane), live on 9 October 2026. It
followed 0.6.0 (referrals, discount codes, phone QR, optional password,
two-step sign-in, sign out everywhere).

## Next, in order

### 1. 0.6.2: guided tour, Help guides, a clearer first run

- **State:** released on `dev` on 9 October 2026 (`npm run release -- 0.6.2`).
  CI tags `v0.6.2`; the release repo's **Release** run builds it and waits at
  the Chrome Web Store approval.
- **Contains (ADR-0039):**
  - the guided tour on first run, with a practice card;
  - a corner card offering it to people who already have jobs;
  - Help (?) → How do I…? per-feature guides, with the full tour, shortcuts,
    help pages and Report a problem;
  - the widget's first-run quick guide, and a "doesn't look like a job
    posting" state instead of a job form on other pages;
  - the board opening after install, a clearer empty board, a grouped board
    menu, and higher-contrast small text.
- **Ship it (owner):** approve the run's `chrome-web-store` deployment
  (Actions → the run → Review deployments).
- **When it's live:** set "Current version" on `/known-issues/` to 0.6.2 and
  the date. The store screenshots still show the old header (no Help button);
  retake them when convenient (`npm run store:screenshots`).

## Adding to the backlog

When something user-facing lands in the extension on `dev`, add it to the
first unreleased entry above (or start a new one), and keep `CHANGELOG.md`'s
_Unreleased_ section in step with it.
