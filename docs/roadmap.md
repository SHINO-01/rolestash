# Roadmap

Ideas are grouped by theme, roughly in priority order. Each should respect the
constraints in AGENTS.md (no AI, no third parties, least privilege).

## Next

- **Verify adapters against live sites.** Replace synthetic fixtures with
  scrubbed real snapshots, starting with LinkedIn, SEEK, Indeed, Greenhouse,
  Lever, Workday; set `lastVerified`.
- **Paste a link.** Capture a URL without opening it: `optional_host_permissions`
  per site, `fetch` + `DOMParser` in an offscreen document, same pure extractor;
  fall back to a background tab for JS-rendered pages.
- **Follow-up reminders & deadlines.** `followUpAt` field, `chrome.alarms` +
  `chrome.notifications`, "closing soon" digest from `closesAt`.
- **Customise columns.** Rename, recolor, reorder, add/archive stages (stages
  are already data in settings).

## Later

- **Side panel** (`chrome.sidePanel`) showing the board or the current job's card while browsing.
- **Contacts & interviews** per job (recruiter, interview dates, outcomes).
- **Analytics view**: funnel conversion by stage, response time, source site.
- **Documents**: which CV/cover letter version was sent (file names, not uploads).
- **Bulk actions**: multi-select, archive, tag.
- **CSV export** for spreadsheets.
- **Opt-in sync** under user control (e.g. `chrome.storage.sync` for metadata,
  or a backup file in a user-chosen folder) — needs an ADR.
- **Firefox / Edge builds** (WXT supports both; mostly manifest differences).

## Tech debt / quality

- Component tests for the drawer and popup form (React Testing Library).
- Visual regression screenshots in CI.
- Performance check with 1,000+ jobs (virtualised columns if needed).
