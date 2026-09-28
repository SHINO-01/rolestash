# AGENTS.md — working in this repository

Instructions for anyone (human or AI coding agent) changing Jobtrail. Read this
before your first change; it is short on purpose. Details live in `docs/`.

## Non-negotiable product constraints

1. **No AI/LLM calls and no third-party services.** No network requests at all
   from the extension, except to the page the user is already on. No analytics,
   no remote config, no CDN assets, no remote fonts. Bundled npm libraries are
   fine; hosted services are not.
2. **Local-first.** Data lives in `chrome.storage.local`. Export/import is the
   backup story.
3. **Least privilege.** Adding a permission requires a justification in
   `docs/reference/permissions.md` and usually an ADR. Never add `<all_urls>`
   host permissions to production builds (the `e2e` build mode is the only
   exception).
4. **Never render posting HTML.** Descriptions are stored and shown as plain
   text (ADR-0005).

## Architecture rules (enforced by ESLint where possible)

```
entrypoints ─► features ─► ui
     │             │
     ▼             ▼
  platform ─► services ─► storage ─► domain
                  │                    ▲
                  └──────► extraction ─┘
```

- `domain/` and `extraction/` are **pure**: no `chrome`/`browser`, no React, no
  storage. ESLint blocks those imports.
- Only `platform/` talks to `chrome.*`. Everything else depends on ports
  (`KeyValueStore`, `ExtractorRunner`) so it runs in unit tests.
- All job mutations go through `JobService`. UI never writes storage directly.
- Zod schemas in `domain/` are the single source of truth for types.

## Workflow

- `npm run verify` must pass before you finish (format, lint with zero
  warnings, typecheck, unit tests, build). Run `npm run test:e2e` when you touch
  entrypoints, platform code or the board's drag-and-drop.
- Every behaviour change ships with a test. Extraction changes ship with a
  fixture (`tests/fixtures/sites/<adapter>/<case>.html` + `.expected.json`).
- Changed adapters? Run `npm run docs:sites` (a test fails if you forget).
- Changed the stored shape of a Job or Settings? Add a migration
  (`src/storage/migrations.ts`) **and** a backup upgrade step, plus tests. See
  `docs/reference/storage.md`.
- Significant decision? Add an ADR in `docs/adr/` (copy `0000-template.md`).
- Update `CHANGELOG.md` under _Unreleased_.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).

## Where to start for common tasks

| Task                        | Start here                             |
| --------------------------- | -------------------------------------- |
| Fix or add a job site       | `docs/guides/adding-a-site-adapter.md` |
| A capture came out wrong    | `docs/guides/debugging-extraction.md`  |
| New board feature           | `docs/guides/adding-a-feature.md`      |
| Change what is stored       | `docs/reference/storage.md`            |
| Understand the moving parts | `docs/architecture/overview.md`        |

## Gotchas

- Chrome injects an unlayered stylesheet into extension pages; base styles that
  must win live **outside** `@layer` in `src/ui/styles.css`.
- The injected extractor's return value crosses `executeScript`, so
  `ExtractionResult` must stay structured-clone-safe plain data (a test checks).
- MV3 service workers die when idle: keep `background.ts` stateless.
- Adapter ids are stored on every job — never rename a released id.
