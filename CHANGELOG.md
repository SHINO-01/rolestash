# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **History and archiving:**
  - Archive any job from its menu. It leaves the board, stops counting toward
    your plan's active jobs, and can be restored any time (subject to the
    limit).
  - _History_ lists finished (Offer, Rejected, Withdrawn) and archived jobs.
  - On Free, finished and archived jobs and timeline entries older than 30
    days are hidden, never deleted, and exports include them. Pro and
    Advanced show everything.
  - Long timelines show the latest 30 entries, with "Show all".
- **Export to CSV** from the board menu, on every plan: one row per job with
  every field, in board order. It opens cleanly in Excel, Numbers and Google
  Sheets (UTF-8 BOM), and cells that a spreadsheet would run as formulas are
  neutralised.
- Groundwork for Rolestash Pro, switched off in release builds until launch:
  - sign-in with Google or an emailed code;
  - a 30-day trial;
  - three plans: Free (15 active jobs), Pro (45) and Advanced (95), with
    rejected and withdrawn jobs not counting and local prices in the UK,
    Ireland and Australia;
  - switching between Pro and Advanced at any time, prorated;
  - Paddle checkout and the billing portal;
  - account deletion that keeps your local jobs.

### Changed

- "Notify me at launch" on rolestash.com is now a real launch list:
  - a form with double opt-in;
  - an automatic acknowledgement email once confirmed;
  - a one-click launch-day announcement (**Actions → Announce launch**).

  - occasional product news (**Actions → Send product news**, from
    `emails/news/`).

  Every email has a one-click unsubscribe (link and mail-app button) that
  deletes the address at once. It's built on Supabase and Resend, with no
  new vendors. The privacy policy has a "Launch and product news emails"
  section, and the terms a new §8, "Emails from us".

- Redesigned rolestash.com: a framed product hero with responsive, art-directed
  board screenshots, a bento feature grid, an email-updates walkthrough for
  Advanced, a plan comparison table, a JavaScript-free mobile menu, a larger
  footer and motion that respects reduced-motion. Pricing cards now have hover
  states and "Notify me at launch" buttons. `npm run site:chrome` stamps the
  shared header and footer; `npm run site:screenshots` regenerates the board
  screenshots from the E2E build.
- Links to rolestash.com now show a preview card (a 1200×630 PNG with Open
  Graph and Twitter tags); `npm run site:og` regenerates it.
- Sync is on both paid plans: Pro syncs up to 3 computers, and Advanced syncs
  up to 5 devices, including phones through the web board (ADR-0013
  revision). The site, terms, privacy policy, support page and the
  extension's plan copy say so.
- The privacy policy and support page now say that accounts are for Pro and
  Advanced, and that sync is an Advanced feature.
- Renamed to **Rolestash**, with a new logo, icons and spruce-green theme.
  Backups exported under the old name still import, and manually added jobs
  keep working.

## [0.1.0] — 2026-09-30

### Added

- Capture the current tab from the popup (review and edit before saving), the
  page context menu, or <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>J</kbd> (instant save with badge feedback).
- Layered, AI-free extraction engine: JSON-LD → microdata → site adapters →
  meta/heuristics, merged per field by confidence with provenance recorded.
- 50 site adapters (job boards, aggregators, government boards and ATS
  platforms), including canonical-URL resolution for list/search views.
- Duplicate detection by canonical URL and by site + posting id.
- Kanban board: seven default columns, drag-and-drop between and within
  columns (mouse and keyboard), search, stats, job drawer with inline editing,
  tags, auto-saving notes, description snapshot and activity timeline.
- Manual job entry; delete with undo.
- JSON backup export/import (merge or replace), versioned and validated.
- Light, dark and system themes.
- Versioned storage with forward-only migrations.
- Unit (Vitest), fixture-driven extraction and E2E (Playwright) test suites,
  with a 90% coverage gate on the core and a smoke suite for the production build.
- CI/CD: push to `dev` → quality, unit/coverage and E2E gates → fast-forward
  `main` → tag and GitHub Release on version bumps; packaged and published by
  [jobtrail-extension](https://github.com/SHINO-01/jobtrail-extension).
- `npm run release` to bump the version and roll the changelog.
