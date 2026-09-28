# Testing

## Layers

| Suite         | Tool                  | Location                  | Runs in CI    |
| ------------- | --------------------- | ------------------------- | ------------- |
| Unit          | Vitest + happy-dom    | `tests/unit/**`           | yes           |
| Site fixtures | Vitest (data-driven)  | `tests/fixtures/sites/**` | yes           |
| Docs drift    | Vitest                | `tests/unit/docs.test.ts` | yes           |
| End-to-end    | Playwright + Chromium | `tests/e2e/**`            | yes (2nd job) |

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

## E2E tests

`npm run test:e2e` builds with `--mode e2e` (adds `<all_urls>` host permission
so the test can inject without a user gesture) and launches Chromium with the
unpacked extension. The spec:

- injects the real `extractor.js` into fixture pages served on localhost,
- drives the board: empty state, seeded cards, drawer editing with persisted
  notes, drag-and-drop across columns with persisted stage and activity, search.

Set `PLAYWRIGHT_CHROMIUM_PATH` to use a system Chromium instead of Playwright's download.

Not covered by E2E: opening the real toolbar popup (Playwright can't click the
toolbar). The popup's logic is covered by unit tests of `CaptureService`,
`JobService` and `capture-draft`.
