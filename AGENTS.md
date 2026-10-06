# AGENTS.md — working in this repository

Instructions for anyone (human or AI coding agent) changing Rolestash. Read this
before your first change; it is short on purpose. Details live in `docs/`.

## Non-negotiable product constraints

1. **No AI/LLM vendors, and only first-party network calls.** The extension may
   contact only the page the user is on, our Supabase project and the
   merchant of record's hosted checkout/portal (opened as tabs), per ADR-0009,
   plus, once the user connects a mailbox, Google's or Microsoft's sign-in and
   mail APIs, read-only (ADR-0032). Mailbox content is processed on the device
   and never sent to our servers.
   No analytics, no crash reporting, no remote config, no CDN assets, no remote
   fonts. Bundled npm libraries are fine. Optional on-device Chrome built-in AI
   is the only AI allowed. PRIVACY.md is updated in the same PR as any new
   network call.
2. **Local-first.** Data lives in `chrome.storage.local`, the source of truth.
   The board works offline and without an account. Sync is an optional layer
   behind a port. A lapsed subscription drops back to the free tier and never
   blocks viewing, editing, exporting or deleting your own data.
3. **Least privilege.** Adding a permission requires a justification in
   `docs/reference/permissions.md` and usually an ADR. The widget's button has required access to the supported job sites only;
   every other site is optional access the user turns on (ADR-0033). Its
   content script draws only the button and reads nothing until the user opens
   the panel. Never widen what it does on a page without an ADR, and never make
   broad host access required.
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

- `domain/`, `extraction/`, `email/` and `autofill/` are **pure**: no `chrome`/`browser`, no
  React, no storage. ESLint blocks those imports. `email/` also runs in a
  Cloudflare Worker, so it must not use the DOM either.
- Only `platform/` talks to `chrome.*`. Everything else depends on ports
  (`KeyValueStore`, `ExtractorRunner`) so it runs in unit tests.
- All job mutations go through `JobService`. UI never writes storage directly.
- Zod schemas in `domain/` are the single source of truth for types.

## Workflow

- Commit and push straight to `dev`: no feature branches or PRs in this
  repository. **Never push to `main`**: CI fast-forwards it after the checks
  pass (docs/guides/ci-cd.md). The release repo (rolestash-extension) is the
  one that takes PRs into its `main`.
- Releasing = `npm run release -- <patch|minor|major>` on `dev`, then push
  (docs/guides/releasing.md).
- `npm run verify` must pass before you finish (format, lint with zero
  warnings, typecheck, unit tests, build). Run `npm run test:e2e` when you touch
  entrypoints, platform code, the widget or the board's drag-and-drop, and
  `npm run test:db` (Docker) when you change the database.
- Every behaviour change ships with a test. Extraction changes ship with a
  fixture (`tests/fixtures/sites/<adapter>/<case>.html` + `.expected.json`).
- Changed the email rules? Add a fixture to `tests/fixtures/emails/` for the
  case (fictional companies only); the corpus test needs 100% precision for
  automatic changes (`docs/guides/email-updates.md`).
- Changed adapters? Run `npm run docs:sites` (a test fails if you forget).
- Changed the stored shape of a Job or Settings? Add a migration
  (`src/storage/migrations.ts`) **and** a backup upgrade step, plus tests. See
  `docs/reference/storage.md`.
- Significant decision? Add an ADR in `docs/adr/` (copy `0000-template.md`).
- Changed what a homepage feature clip shows (the widget, autofill, the
  board, email updates, the web board)? Re-shoot them with `npm run site:clips`
  and bump the clip version (docs/guides/website.md#feature-clips).
- Update `CHANGELOG.md` under _Unreleased_, then run `npm run site:changelog`
  (rolestash.com/changelog/ is rendered from it; a test fails if it's stale).
- Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).

## Where to start for common tasks

| Task                        | Start here                             |
| --------------------------- | -------------------------------------- |
| Fix or add a job site       | `docs/guides/adding-a-site-adapter.md` |
| A capture came out wrong    | `docs/guides/debugging-extraction.md`  |
| New board feature           | `docs/guides/adding-a-feature.md`      |
| Change what is stored       | `docs/reference/storage.md`            |
| Accounts, billing, database | `docs/guides/backend.md`               |
| Understand the moving parts | `docs/architecture/overview.md`        |
| Operations dashboard        | `docs/guides/operations.md`            |
| The website, rolestash.com  | `docs/guides/website.md`               |
| Email updates, mailboxes    | `docs/guides/email-updates.md`         |
| Releasing                   | `docs/guides/releasing.md`             |
| What's still open           | `docs/todo.md`                         |

## Gotchas

- Chrome injects an unlayered stylesheet into extension pages; base styles that
  must win live **outside** `@layer` in `src/ui/styles.css`.
- The injected extractor's return value crosses `executeScript`, so
  `ExtractionResult` must stay structured-clone-safe plain data (a test checks).
- MV3 service workers die when idle: keep `background.ts` stateless.
- Adapter ids are stored on every job — never rename a released id.
- The paid plan is Pro, but the database stores it as tier `advanced`
  (ADR-0029). Gate features with `allows(plan, feature)`, which means "is paid"; never add a
  second paid tier in code.
- WXT entrypoint names must be unique (the `widget/` page and
  `launcher.content.ts`); run `npx wxt prepare` after adding one so
  `browser.runtime.getURL` types update.
- E2E builds hold `<all_urls>` and treat `localhost` and `127.0.0.1` as job
  sites, with the widget's shadow root open so Playwright can click it;
  production's is closed. The panel grows upwards from the bottom, so wait
  for it to settle before clicking inside it.
- The repos are public: security findings stay in the git-ignored private
  list until fixed, never in commits, issues or PRs.
