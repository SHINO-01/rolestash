# ADR-0034: Four board lanes; Rejected tracked off the board; Screening and Withdrawn retired

- **Status:** Accepted (owner, 2026-10-07), with the recommended answers below. Built 2026-10-07 (code, tests, docs); ships in 0.5.0 with re-shot clips and screenshots.
- **Amended 2026-10-08 (owner):** Rejected gets its lane back, so the board has
  five lanes. Decision 2 ("a `lost` column never gets a lane") no longer
  holds: `laneStages()` returns every visible column, and the new
  `captureStages()` (visible, not `lost`) keeps Rejected out of the places a
  new job starts. Everything else here stands: Screening and Withdrawn stay
  retired, migration v2 and the read-side normalisation are unchanged.
- Amends the default columns in `src/domain/stage.ts` and custom columns
  (`src/domain/columns.ts`). Touches ADR-0014 (email intents → columns) and
  Insights.

## Context

The board shows seven lanes: Saved, Applied, Screening, Interviewing, Offer,
Rejected, Withdrawn. The homepage film, the feature clips and the store
promo show four: **Saved, Applied, Interviewing, Offer**. The owner wants the
extension to match: four lanes, Rejected kept as a status (set from the job
drawer's column dropdown) but with no lane, and Screening and Withdrawn gone.

Columns are data, not code: `settings.stages` holds each column with a
`kind` (`active`, `won`, `lost`) and `marksApplied`; Pro users can rename,
add and archive columns; settings sync across devices (`@settings` row,
last writer wins). Almost everything reads stages through that list, so the
change is mostly new defaults, one migration, and "lost columns have no
lane".

## Decision

1. **Defaults:** Saved (active), Applied (active, marks applied),
   Interviewing (active, marks applied), Offer (won), Rejected (lost,
   **hidden from the board**). `screening` and `withdrawn` leave
   `DEFAULT_STAGES`.
2. **Rule, not a special case:** a `lost` column never gets a lane. It stays in
   the drawer's column dropdown, bulk "Move to", the web board's job sheet
   and History. (Pro users' own `lost` columns, if any, behave the same.)
3. **Migration v2** (`src/storage/migrations.ts`, mirrored in
   `upgradeBackup()`):
   - jobs in `screening` move to **`interviewing`** (recommended: a screen is
     the employer's first conversation; moving back to Applied would hide that
     they replied). Alternative: `applied`.
   - jobs in `withdrawn` move to **`rejected`** (both are `lost`, so active
     counts, History and Insights' endings don't change), with an activity
     entry "Withdrawn (column retired)" so the history keeps the truth.
   - `settings.stages`: drop the default `screening` and `withdrawn` entries
     only when their `id` is the default one; rename/colour customisations
     of the remaining defaults are kept; user-made columns are untouched.
4. **Normalise on every read, not only once:** extensions on 0.4.7 and the
   web board will keep syncing `screening`/`withdrawn` for weeks (store review
   lag). One pure function `normalizeStages()` + `retiredStageAlias()`
   applied wherever stages or jobs come in (repository read, sync pull, backup
   import, web board) keeps old data from reviving the lanes. Without it a
   `screening` job falls into the Saved lane (`board-columns.ts` sends unknown
   column ids to the default column), which would be wrong and alarming.
5. **Email "assessment" intent** (take-home, coding test, screening call)
   currently targets Screening. New target: **no column move**; the update is
   recorded on the card (activity + email chip) and moves Saved → Applied only,
   like "received". Interview, offer and rejection mappings are unchanged.

## What changes, by area (audit, 2026-10-07)

| Area                     | Files                                                                                                      | Change                                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Column model             | `domain/stage.ts`, `domain/columns.ts`, `domain/settings.ts`                                               | New defaults; `normalizeStages()`; aliases for retired ids; lost = no lane                                  |
| Migration and backups    | `storage/migrations.ts` (v1 → v2), `storage/backup.ts`                                                     | Move jobs, prune stages, keep history; mirror in backup upgrade                                             |
| Board                    | `features/board/board-columns.ts`, `kanban.tsx`, `board-column.tsx`, `columns-dialog.tsx`, `stats.ts`      | Lanes exclude `lost`; the columns editor shows Rejected as "Off the board"; header counts unchanged         |
| Job drawer               | `features/board/job-drawer.tsx`                                                                            | Dropdown keeps every column incl. Rejected (as in the owner's screenshot), minus Screening/Withdrawn        |
| History                  | `features/board/history-dialog.tsx`, `domain/history.ts`                                                   | Copy: "Offer or Rejected" (drop Withdrawn); rejected jobs are found here                                    |
| Widget                   | `features/capture/capture-widget.tsx` (StagePicker)                                                        | Chips: Saved, Applied, Interviewing, Offer (no lost columns), matching the promo                            |
| Bulk actions             | `features/board/bulk-bar.tsx`                                                                              | "Move to" includes Rejected                                                                                 |
| Plan limits copy         | `account/plan-copy.ts`, `plan-banner.tsx`, `account-dialog.tsx`, `capture-widget.tsx`                      | "Move finished ones to Rejected" (drop "or Withdrawn"); `countActiveJobs` unchanged (still excludes `lost`) |
| Email updates            | `email/match.ts` (`targetStage`), `services/email-update-service.ts`, fixtures                             | Assessment: no move (see 5). Corpus test expectations updated; 100% precision gate must still pass          |
| Insights / journey chart | `domain/insights.ts`, `features/insights/*`, `sankey-layout.ts`                                            | Fewer stage nodes; Rejected stays an "ended" node; doc comments                                             |
| Web board (phone)        | `src/web/board-view.tsx`, `job-sheet.tsx`, `job-row.tsx`, `today-view.tsx`, `quick-add.tsx`                | Tabs: four lanes; sheet select keeps Rejected; normalise on read                                            |
| Sync                     | `services/sync-service.ts`                                                                                 | Normalise pulled settings and jobs; never push retired ids back                                             |
| CSV export               | `storage/csv-export.ts`                                                                                    | Column names follow stages (no code change expected; test)                                                  |
| Tests                    | 11 files (unit: stage, columns, history, insights, sankey, plan, job-limit, email match; e2e; perf; clips) | Update fixtures/expectations; new migration + normalisation + sync-revival tests                            |
| Site and marketing       | `site/index.html` (board screenshot alt text), `guides/track-job-applications/`, board screenshots         | Re-run `npm run site:screenshots`, `npm run store:screenshots`; copy; the guide's stage list                |
| Promo media              | feature clips (board clip drags into Screening), hero film (widget chips and Insights show Screening)      | Re-shoot clips (`npm run site:clips`, bump version); re-render the film's widget and Insights scenes        |
| Docs                     | `docs/reference/data-model.md`, `docs/guides/email-updates.md`, README, this ADR                           | Columns list, intent mapping                                                                                |

## Implementation plan (in order, each step verified)

1. Domain: defaults, `normalizeStages()`, `retiredStageAlias()`, unit tests.
2. Migration v2 + backup upgrade + tests (seed old shape → assert new).
3. Read-side normalisation in the repository, sync pull and web board;
   a test that a 0.4.7-shaped `@settings` row can't bring Screening back.
4. Board: lanes exclude `lost`; columns editor; drawer and bulk lists; widget
   chips; copy changes.
5. Email: assessment mapping, fixtures, corpus test.
6. Insights: labels, sankey tests.
7. Web board: tabs and sheet.
8. `npm run verify`, `npm run test:e2e`, then re-shoot the clips, regenerate
   board/store screenshots, update site copy, and re-render the affected film
   scenes.
9. Release as a minor version (0.5.0): it migrates stored data. The store
   listing screenshots change in the same release PR.

## Owner decisions (2026-10-07)

1. Screening jobs move to **Interviewing**.
2. Withdrawn jobs move to **Rejected**, with a history entry recording that
   they were withdrawn.
3. The widget's chips **don't** offer Rejected; it's set from the job drawer
   (and bulk "Move to", the web board's job sheet).

## Consequences

- The board matches the promo, and a rejection no longer takes a lane.
- Stored data is migrated once and normalised on every read, so old devices
  can't revive retired columns.
- Withdrawn and Screening lose their distinct meaning; the history entry keeps
  what happened.
