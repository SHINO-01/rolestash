# ADR-0007: One storage key per job, versioned forward-only migrations

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

`chrome.storage.local` is shared by the popup, board and background worker,
which may write concurrently. The schema will evolve as features are added.

## Decision

- Layout: `meta` (schema version), `settings`, and `job:<id>` per job.
- All access goes through repositories over a `KeyValueStore` port; the
  `chrome.storage` adapter is the only implementation in production.
- Validate with zod on write; tolerate and skip invalid records on read.
- `migrate()` runs ordered, idempotent, forward-only migrations and records
  `meta.schemaVersion`. Data from a newer build is refused, not guessed at.
- Backups carry `schemaVersion` and pass through `upgradeBackup()`.

## Consequences

- Concurrent writes to different jobs never clobber each other.
- Listing reads the whole store — fine up to thousands of jobs; revisit with an
  index or IndexedDB (a new `KeyValueStore` adapter) if that changes.
- Every stored-shape change needs a migration + backup upgrade + tests.

## Alternatives considered

- **IndexedDB:** queryable, but no cross-context change events and more
  ceremony; kept as an upgrade path behind the port.
- **Single `jobs` key:** simpler reads, but every write rewrites everything and races.
