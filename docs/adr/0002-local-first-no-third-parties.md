# ADR-0002: Local-first, no AI, no third-party services

- **Status:** Accepted; network and backend parts superseded by ADR-0009
- **Date:** 2026-09-29

## Context

A job search history is personal data (salaries, rejections, notes about
recruiters). The product requirement is explicit: no AI and no third-party
vendors.

## Decision

- Extraction is deterministic code (ADR-0003); no model, local or remote.
- The extension makes **no network requests**: no backend, analytics, error
  reporting, remote config, CDN assets or remote fonts. Company avatars are
  generated initials, not fetched logos or favicons.
- Data lives in `chrome.storage.local`. Backup and device transfer are JSON
  export/import.
- Bundled open-source libraries are allowed; they are code, not services.

## Consequences

- Nothing to host, no accounts, no privacy policy beyond "we collect nothing" (PRIVACY.md).
- No automatic multi-device sync. A future sync feature must stay
  user-controlled (e.g. `chrome.storage.sync` for metadata only, or a file the
  user places in their own cloud folder) and needs its own ADR.
- Extraction quality depends on maintained adapters rather than a model;
  mitigated by structured data coverage and the popup's review step.

## Alternatives considered

- **LLM extraction:** excluded by requirement; also slow, costly and non-deterministic.
- **Company logo APIs (Clearbit etc.):** third-party requests leak which companies you're applying to.
- **Chrome `_favicon` cache:** local and allowed, but shows a generic globe for
  sites the browser hasn't cached and a job board's icon rather than the
  employer's, so it added noise, not signal. Removed along with the `favicon` permission.
