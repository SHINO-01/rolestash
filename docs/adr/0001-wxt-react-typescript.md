# ADR-0001: Build with WXT, React, TypeScript and Tailwind

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

The extension needs several surfaces (popup, full-page board, service worker,
injected script), a rich drag-and-drop UI, and must stay maintainable while
features are added for years.

## Decision

- **WXT** (Vite-based) for the extension build: file-based entrypoints,
  generated manifest, HMR in `npm run dev`, zipping for the store, and an e2e
  build mode.
- **React 19** for UI, **@dnd-kit** for accessible drag-and-drop (mouse and keyboard).
- **TypeScript** in strict mode (`noUncheckedIndexedAccess`), ESLint
  `strictTypeChecked`, Prettier.
- **Tailwind CSS v4** with semantic design tokens (`bg-surface`, `text-muted`)
  defined once in `src/ui/styles.css`, so theming never touches components.
- **Zod** schemas as the single source of truth for types and runtime validation.
- **Inter** bundled via `@fontsource-variable/inter` (no remote fonts, ADR-0002).

## Consequences

- One mainstream toolchain; contributors don't need to learn extension build tooling.
- Bundle ~350 kB for the UI chunk — irrelevant for a locally loaded extension.
- WXT is a younger project than raw Vite; if it's ever abandoned, entrypoints
  are plain HTML/TS files and migrate to `@crxjs/vite-plugin` or bare Vite easily.

## Alternatives considered

- **Plain Vite + hand-written manifest:** more glue code, no dev-mode reload for the worker.
- **Plasmo:** heavier abstraction, Parcel-based.
- **Svelte/Vue:** fine choices; React has the most mature a11y drag-and-drop library.
