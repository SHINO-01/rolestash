# ADR-0005: Store and display descriptions as plain text

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

Snapshotting the description matters (postings disappear after they close),
but posting HTML is untrusted input from thousands of sites.

## Decision

Convert descriptions to plain text at extraction time (`elementToText` /
`htmlToText`): paragraphs become blank lines, list items become `•` bullets,
scripts/styles/buttons are dropped. Parsing uses `DOMParser` (inert: no script
execution, no resource loading). The UI renders with `white-space: pre-wrap`.
No `dangerouslySetInnerHTML` anywhere.

## Consequences

- No XSS surface and no need for a sanitizer dependency.
- Loses bold/links/headings formatting; acceptable for a reference snapshot.
- Capped at 60k characters to bound storage.

## Alternatives considered

- **Sanitised HTML (DOMPurify):** richer display, but a permanent security
  responsibility and more storage.
