# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

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
