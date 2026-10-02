# Architecture overview

Rolestash is a Manifest V3 Chrome extension built with [WXT](https://wxt.dev),
React and TypeScript. It is local-first: every component runs inside the
browser, and `chrome.storage.local` is the source of truth. The optional
server side (accounts, billing, sync, email updates: Supabase, Paddle and a
Cloudflare Email Worker) is a layer behind ports, described in the
[backend guide](../guides/backend.md); builds without backend settings have
none of it.

## Extension surfaces (entrypoints)

| Entrypoint                      | Runs in                | Responsibility                                                    |
| ------------------------------- | ---------------------- | ----------------------------------------------------------------- |
| `src/entrypoints/popup/`        | Toolbar popup          | Capture the active tab, let the user review/edit, save            |
| `src/entrypoints/board/`        | Extension page (tab)   | The Kanban board, job drawer, import/export                       |
| `src/entrypoints/sidepanel/`    | Docked side panel      | Save this page, open the board; Advanced: Today, board, job sheet |
| `src/entrypoints/background.ts` | MV3 service worker     | Context menu + shortcut "instant save", badge feedback, reminders |
| `src/entrypoints/extractor.ts`  | Injected into the page | Runs `extractJob(document, location.href)` and returns the result |
| `src/entrypoints/autofill.ts`   | Injected into the page | Fills an application form from the local profile, on a click      |

The extractor is an **unlisted script**: it is never registered as a content
script, only injected with `chrome.scripting.executeScript` after a user
gesture (ADR-0004).

## Layering

```
entrypoints ─► features ─► ui
     │             │
     ▼             ▼
  platform ─► services ─► storage ─► domain
                  │                    ▲
                  └──────► extraction ─┘
```

| Layer         | Contains                                                            | May depend on                     |
| ------------- | ------------------------------------------------------------------- | --------------------------------- |
| `domain/`     | Zod schemas (Job, Stage, Settings), pure state transitions, ranking | nothing (zod only)                |
| `extraction/` | Strategies, normalisers, site adapters, pipeline                    | `domain` types                    |
| `email/`      | Email status updates engine: intent rules, dates, matching          | `domain`, `extraction`            |
| `autofill/`   | Application autofill: reading and filling forms (injected on click) | `domain`                          |
| `storage/`    | `KeyValueStore` port, repositories, migrations, backup format       | `domain`                          |
| `services/`   | Use cases (`JobService`, `CaptureService`), ports, composition root | `domain`, `extraction`, `storage` |
| `platform/`   | `chrome.*` adapters: storage, scripting, tabs, badge                | everything below                  |
| `ui/`         | Design tokens, primitives, React bindings to services               | `services`, `domain`              |
| `features/`   | Board and capture screens                                           | `ui`, `services`, `platform`      |

`domain/`, `extraction/`, `email/` and `autofill/` are pure; ESLint's
`no-restricted-imports` and `no-restricted-globals` enforce it. `email/` also
uses no DOM at all, because it runs in a Cloudflare Email Worker
([email updates guide](../guides/email-updates.md)). Purity is what lets the extractor run in
three places unchanged: the live page, unit tests (happy-dom), and in future a
DOMParser document for a "paste a URL" flow.

### Ports and adapters

Services depend on two interfaces:

- `KeyValueStore` (`storage/key-value-store.ts`) — `get / set / remove / subscribe`.
  Implemented by `ChromeKeyValueStore` (platform) and `MemoryKeyValueStore` (tests).
- `ExtractorRunner` (`services/ports.ts`) — run the extractor in a tab, or snapshot its HTML.
  Implemented by `ScriptingExtractorRunner` (platform) and fakes in tests.

`services/container.ts` wires them into a `Services` object. Each extension
context builds one (`platform/services.ts`), runs migrations once
(`services.ready`), and React reads it through `ServicesProvider`.

## Data flow: capturing a job from the popup

```
User clicks toolbar icon
  └─► popup: getActiveTab()                         (activeTab grants access now)
       └─► CaptureService.capture(tabId)
            └─► ScriptingExtractorRunner.run(tabId) — executeScript(files: extractor.js, allFrames)
                 └─► [in page] extractJob(document, url) → ExtractionResult (per frame)
            ◄── pickBest(results)
       └─► JobService.findDuplicate(url, site, externalId)
       └─► user edits draft → JobService.createFromExtraction(result, overrides)
            └─► createJob() (domain) → JobRepository.save() → chrome.storage.local
                                                       └─► storage.onChanged ─► board updates live
```

The instant-save path (context menu / <kbd>Alt+Shift+J</kbd>) runs the same services from
the background worker and reports via the toolbar badge.

## Data flow: moving a card

`Kanban` keeps a local copy of the column layout during a drag (dnd-kit). On
drop it translates the visual position into an index among _all_ jobs in the
stage (`resolveDropIndex` — the board may be filtered), calls
`JobService.move()`, and applies the returned jobs optimistically via
`LiveJobs.applyLocal()` so nothing flickers. `move()` writes one record
(fractional rank, ADR-0006), or the whole column when ranks need rebalancing.

## Live updates across contexts

`JobRepository.subscribe` listens to `chrome.storage.onChanged`, which fires in
every extension context. A job saved from the popup or background therefore
appears on an open board immediately, with no messaging layer.

## Directory map

```
src/
  domain/          job.ts (schemas), stage.ts, settings.ts, rank.ts, job-factory.ts
  extraction/
    extract.ts     the pipeline
    merge.ts       per-field confidence merge
    strategies/    json-ld.ts, microdata.ts, adapter.ts, meta.ts, shared.ts
    normalize/     text.ts, salary.ts, dates.ts, classifiers.ts, url.ts
    adapters/      types.ts, helpers.ts, registry.ts, sites/*.ts (50)
  email/           analyze.ts (entry), intent.ts, ats.ts, links.ts, ics.ts, time.ts, clean.ts, html.ts, match.ts, skeleton.ts
  autofill/        fields.ts (reading a form), fill.ts (filling it)
  storage/         key-value-store.ts, job-repository.ts, settings-repository.ts, migrations.ts, backup.ts
  services/        job-service.ts, capture-service.ts, ports.ts, container.ts
  platform/        chrome-storage.ts, extractor-runner.ts, tabs.ts, badge.ts, services.ts
  ui/              styles.css (tokens), components/, hooks/, format.ts, app-root.tsx
  features/
    board/         board-page, kanban, board-column, job-card, job-drawer, dialogs, stats
    capture/       capture-popup, capture-form, capture-draft, debug-panel
  entrypoints/     background.ts, extractor.ts, popup/, board/
```
