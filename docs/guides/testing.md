# Testing

## Layers

| Suite         | Tool                  | Location                         | Runs in CI                           |
| ------------- | --------------------- | -------------------------------- | ------------------------------------ |
| Unit          | Vitest + happy-dom    | `tests/unit/**`                  | yes                                  |
| Site fixtures | Vitest (data-driven)  | `tests/fixtures/sites/**`        | yes                                  |
| Docs drift    | Vitest                | `tests/unit/docs.test.ts`        | yes                                  |
| End-to-end    | Playwright + Chromium | `tests/e2e/**` (project `e2e`)   | yes                                  |
| Smoke         | Playwright + Chromium | `@smoke` tests (project `smoke`) | yes, here and in rolestash-extension |
| Database      | pgTAP (Docker)        | `supabase/tests/database/**`     | yes (_Database_ job)                 |
| Performance   | Playwright + Chromium | `tests/perf/**` (project `perf`) | no: run by hand                      |

## Unit tests

`npm test`. Helpers: `tests/unit/helpers/dom.ts` (`htmlDoc`, `fixtureDoc`,
`jsonLdDoc`) and `factories.ts` (`makeJob`, `makeResult`, `testContext` —
a deterministic clock and id generator). Services are tested against
`MemoryKeyValueStore` and a fake `ExtractorRunner`: no browser needed.

## Fixture tests

Each `tests/fixtures/sites/<adapter>/<case>.html` with a sibling
`<case>.expected.json` becomes four tests (site + canonical URL, fields,
provenance, structured-clone safety). The JSON format is documented in
`tests/fixtures/README.md`. Fixtures marked `SYNTHETIC` model a site's markup;
replace them with scrubbed real snapshots over time.

## Accounts and backend tests

- **Edge Functions:** `tests/unit/functions/` exercises the handlers in
  `supabase/functions/_shared/` with `tests/unit/helpers/fake-fetch.ts`. It
  routes by method and URL, records every call, and rejects anything
  unexpected.
- **Database:** `npm run test:db` (Docker) runs the pgTAP suite for RLS,
  trials and billing events, plus the PL/pgSQL linter.
- **E2E:** the E2E build reads `.env.e2e`, so it talks to the mock Supabase
  in `tests/e2e/mock-backend.ts` (`backend` fixture). The release build has
  a backend only when the release repo sets the `WXT_SUPABASE_*` variables
  (at launch). The `@smoke` tests read the manifest and check whichever mode
  was built:
  - **Off:** no `identity` permission, no account UI, nothing limited.
  - **On:** `externally_connectable` is exactly `rolestash.com/board/*`, and
    signed out is Free, with Pro features offered.
  - **Both:** never the development key.

## E2E tests

`npm run test:e2e` builds with `--mode e2e` (adds `<all_urls>` host permission
so the test can inject without a user gesture) and launches Chromium with the
unpacked extension. The spec:

- injects the real `extractor.js` into fixture pages served on localhost,
- drives the board: empty state, seeded cards, drawer editing with persisted
  notes, drag-and-drop across columns with persisted stage and activity, search.

`npm run test:smoke` runs the tests tagged `@smoke` (the board) against the
**production** build, which has no host permissions. The extension repo runs
the same project on every release candidate.

Coverage gate: `npm run test:coverage` fails below 90% lines/statements/functions
(80% branches) on `src/{domain,extraction,storage,services}`. UI and browser
adapters are covered by E2E instead. Tests never touch the network (happy-dom
resource loading is disabled).

## Performance

`npm run perf:board` seeds `PERF_N` jobs (default 1,000) into the production
build, slows the CPU by `PERF_CPU` (default 4×, roughly a modest laptop), and
prints how long the board takes to open, search, drag a card between columns
and open the drawer:

```bash
PERF_N=3000 PERF_CPU=1 npm run perf:board
```

Measure the production build: the e2e build runs React in development mode,
which is several times slower. Run it before and after changes to the board.
Each column shows its first 50 cards (`COLUMN_PAGE`), so open and drag times
stay flat as the board grows. Results on 2026-10-03, CPU not slowed:

| Jobs  | Open   | Search | Drag (20 pointer moves) | DOM nodes |
| ----- | ------ | ------ | ----------------------- | --------- |
| 200   | 250 ms | 80 ms  | 1.1 s                   | 4,000     |
| 1,000 | 340 ms | 170 ms | 1.4 s (was 2.3 s)       | 5,900     |
| 3,000 | 470 ms | 210 ms | 1.4 s (was 5.8 s)       | 5,900     |

Set `PLAYWRIGHT_CHROMIUM_PATH` to use a system Chromium instead of Playwright's download.

Not covered by E2E: opening the real toolbar popup (Playwright can't click the
toolbar). The popup's logic is covered by unit tests of `CaptureService`,
`JobService` and `capture-draft`.
