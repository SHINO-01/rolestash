# Development setup & workflow

## Prerequisites

- Node 22.18+ (`nvm use` reads `.nvmrc`); the release scripts rely on Node's built-in TypeScript support
- Google Chrome or Chromium 116+

## Commands

| Command                    | What it does                                                             |
| -------------------------- | ------------------------------------------------------------------------ |
| `npm install`              | Installs deps and runs `wxt prepare` (generates `.wxt/` types)           |
| `npm run dev`              | Opens a Chrome profile with the extension loaded and hot reload          |
| `npm run build`            | Production build → `.output/chrome-mv3/`                                 |
| `npm run build:e2e`        | Build with test-only host permissions → `.output/chrome-mv3-e2e/`        |
| `npm run zip`              | Store-ready zip in `.output/`                                            |
| `npm run typecheck`        | `tsc --noEmit`                                                           |
| `npm run lint`             | ESLint (strict type-checked + architecture boundaries)                   |
| `npm run format`           | Prettier (with Tailwind class sorting)                                   |
| `npm test`                 | Vitest unit + fixture tests                                              |
| `npm run test:coverage`    | Same, with coverage (HTML report in `coverage/`)                         |
| `npm run test:e2e`         | Builds the e2e variant and runs the full Playwright suite                |
| `npm run test:smoke`       | Builds production and runs the `@smoke` tests against it                 |
| `npm run release -- patch` | Bumps the version and rolls CHANGELOG.md (see [releasing](releasing.md)) |
| `npm run docs:sites`       | Regenerates `docs/reference/supported-sites.md`                          |
| `npm run verify`           | Everything CI's first job runs                                           |

## Loading your build in everyday Chrome

`chrome://extensions` → _Developer mode_ → _Load unpacked_ → `.output/chrome-mv3`.
After rebuilding, click the reload icon on the extension card. Data survives
reloads (it's tied to the extension id, which is stable for an unpacked folder).

## Debugging

- **Popup:** right-click the popup → _Inspect_.
- **Board:** it's a normal tab — DevTools as usual.
- **Background worker:** `chrome://extensions` → _Service worker_ link.
- **Storage:** DevTools on the board → Application → _Extension storage_, or
  run `await chrome.storage.local.get(null)` in the board's console.
- **Extraction:** popup → _Extraction details_ (see [debugging-extraction](debugging-extraction.md)).

## Branches

`dev` is where work happens (default branch). `main` is the released line and
is only moved by CI. See [CI/CD](ci-cd.md).

## Conventions

See [AGENTS.md](../../AGENTS.md). In short: pure domain/extraction, all
mutations through `JobService`, tests with every change, docs and changelog
updated in the same PR.
