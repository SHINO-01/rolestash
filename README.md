<img src="brand/rolestash-logo.svg" alt="Rolestash" height="56">

[![CI](https://github.com/SHINO-01/rolestash/actions/workflows/ci.yml/badge.svg?branch=dev)](https://github.com/SHINO-01/rolestash/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/SHINO-01/rolestash)](https://github.com/SHINO-01/rolestash/releases)

**The private job application tracker.** No AI reading your applications, no
inbox access, no data selling.

Save any job posting to a Kanban board in one click. Rolestash is a Chrome
extension that reads the job page you're on, extracts the title, company,
location, salary, dates and description, and files it as a card on a local
board you drag through _Saved → Applied → Screening → Interviewing → Offer_.

- **No AI.** Extraction is deterministic: structured data first
  (schema.org JSON-LD and microdata), then 50 hand-written site adapters, then
  conservative heuristics. Every field records where it came from.
- **Local-first.** Your data lives in `chrome.storage.local`. The free plan
  needs no account and makes no network requests beyond the page you capture.
  Accounts, sync and email updates are optional paid features on our own
  backend (Supabase, payments by Paddle). No analytics, no remote code, no AI
  vendors.
- **Minimal permissions.** The extension can read a page only after you click it
  (`activeTab`). No "read all your data on all websites" warning.

## Using it

| Action                     | How                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| Capture, review, then save | Click the toolbar icon (or <kbd>Alt</kbd>+<kbd>J</kbd>) on a job page                    |
| Save instantly (no review) | Right-click the page → _Track this job_, or <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>J</kbd> |
| Open the board             | Popup → _Open board_, or right-click the toolbar icon                                    |
| Search the board           | <kbd>/</kbd>                                                                             |
| Add a job by hand          | <kbd>N</kbd> on the board                                                                |
| Back up / move browsers    | Board menu → _Export backup_ / _Import backup_                                           |

Badge feedback for instant saves: **✓** saved, **=** already on your board,
**!** couldn't read the page.

## Getting started (development)

Requires Node 22.18+ (see `.nvmrc`). Work happens on `dev`; CI promotes green
commits to `main` and tags releases. Packaging and Chrome Web Store releases live
in [rolestash-extension](https://github.com/SHINO-01/rolestash-extension).

```bash
npm install
npm run dev          # launches Chrome with the extension and hot reload
npm run build        # production build → .output/chrome-mv3
npm run zip          # store-ready zip → .output/*.zip
npm run verify       # format + lint + typecheck + unit tests + build (what CI runs)
npm run test:e2e     # Playwright against the real built extension
npm run release -- patch   # prepare a release (see docs/guides/releasing.md)
```

To load a build manually: `chrome://extensions` → enable _Developer mode_ →
_Load unpacked_ → select `.output/chrome-mv3`.

## Project layout

```
src/
  entrypoints/   Extension surfaces: background worker, widget (launcher + panel), board page, injected extractor
  domain/        Pure business model (Job, Stage, ranking, state transitions) — zod schemas
  extraction/    Pure extraction engine: strategies, normalisers, 50 site adapters
  storage/       Repositories over a KeyValueStore port, migrations, backup format
  services/      Application use cases (JobService, CaptureService) + composition root
  platform/      The only code that touches chrome.* APIs (adapters for the ports)
  features/      UI features: board/ (Kanban, drawer, dialogs), capture/ (the widget)
  ui/            Design system: tokens, primitives, hooks
tests/
  unit/          Vitest (happy-dom) — domain, extraction, storage, services, board logic
  fixtures/      HTML fixtures; drop in <case>.html + <case>.expected.json to add a test
  e2e/           Playwright — loads the real extension into Chromium
docs/            Knowledge base (start at docs/README.md)
```

## Documentation

The knowledge base lives in [`docs/`](docs/README.md): architecture, decision
records, how-to guides (adding a site adapter, debugging extraction, releasing)
and reference material (data model, storage and migrations, permissions,
supported sites). Contributors — human or AI agent — should read
[`AGENTS.md`](AGENTS.md) first.

## Status

v0.1.0 — first working release. See [`docs/roadmap.md`](docs/roadmap.md) for
what's next and [`CHANGELOG.md`](CHANGELOG.md) for what changed.
