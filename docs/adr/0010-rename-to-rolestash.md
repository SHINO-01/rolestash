# ADR-0010: Rename the product to Rolestash

- **Status:** Accepted
- **Date:** 2026-09-30

## Context

"Jobtrail" is a registered Australian trade mark: no. 2141436, owned by
JOBTRAIL PTY LTD, in classes 35 and 41. We sell from Australia, so shipping a
paid product under that name risks an infringement claim and a forced rename
after launch, which would also cost the store listing, reviews and links.
Nothing has been published to the Chrome Web Store yet, so renaming now
costs the least.

## Decision

- The product is **Rolestash**, and the domain is **rolestash.com**
  (registered 2026-09-30). The brand assets are in `brand/`.
- Every user-facing name changes: manifest, UI copy, page titles, icons,
  theme accent (spruce `#0B5D52`), docs, log prefixes and context-menu ids.
- Stored identifiers change and **keep backward compatibility**:
  - The backup format becomes `rolestash-backup`. `jobtrail-backup` files
    still import.
  - New manual jobs use the placeholder host `rolestash.invalid`.
    `jobtrail.invalid` is still recognised (`isManualUrl` in `domain/job.ts`).
- Adapter ids and storage keys (`job:<id>`, `settings`, `meta`) are
  unchanged, because they don't carry the brand.
- ADRs 0001–0008 and the 0.1.0 changelog entry keep the old name as
  historical records.
- The GitHub repos are renamed separately. Until then, references to
  `SHINO-01/jobtrail` and `jobtrail-extension` stay in the docs and scripts.

## Consequences

- The legacy format and host must stay accepted for as long as old backups
  may exist. Tests cover both.
- The store listing, screenshots and `store/listing.md` in the extension repo
  need the new name before the first submission.

## Alternatives considered

- **Keep Jobtrail:** rejected because of the registered trade mark.
- **Rolejar** (the research's top pick): the owner preferred Rolestash. Both
  had clean Australian and US trade mark searches and free domains.
- **Hard-rename stored ids with a migration:** that would break re-importing
  older backups for no benefit. Accepting the legacy values is cheaper.
