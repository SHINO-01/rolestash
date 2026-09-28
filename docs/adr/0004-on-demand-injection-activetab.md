# ADR-0004: Inject the extractor on demand using `activeTab`

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

The extension needs page content from arbitrary job sites. A persistent content
script with `<all_urls>` would trigger Chrome's "read and change all your data
on all websites" warning and extra Web Store review, and run on every page for
no reason.

## Decision

- Request `activeTab` + `scripting` only.
- Bundle the extractor as an unlisted script (`/extractor.js`) and inject it
  with `chrome.scripting.executeScript({ files, allFrames: true })` only after a
  user gesture (toolbar click, keyboard shortcut, context menu), all of which
  grant `activeTab`.
- The script returns plain data (`ExtractionResult`) as the injection result.

## Consequences

- No scary install warning; zero cost on pages the user doesn't capture.
- Capture requires the job to be open in the current tab ("current tab first"
  product decision). A future "paste a URL" flow will need
  `optional_host_permissions` requested at use time, fetching HTML and parsing
  it with `DOMParser` in an offscreen document — the pure extractor supports that.
- Cross-origin iframes (embedded ATS boards) aren't readable; documented per adapter.
- E2E tests use a separate `e2e` build mode that adds `<all_urls>` so Playwright
  can inject without a real gesture. Production builds never include it.
