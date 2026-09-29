# Contributing

1. Read [AGENTS.md](AGENTS.md) — the product constraints and layering rules.
2. Set up: `nvm use && npm install`.
3. Develop: `npm run dev` opens Chrome with the extension and hot reload.
4. Before pushing: `npm run verify` (and `npm run test:e2e` for UI/platform changes).
5. Push to `dev` or open a PR into `dev`. CI runs quality, unit tests with coverage, and E2E.

## Branches and commits

- `dev` is the default branch. Push small changes directly, or branch from
  `dev` (`feat/…`, `fix/…`) and open a PR into `dev`.
- `main` is updated only by CI (fast-forward after all checks pass).
  See [docs/guides/ci-cd.md](docs/guides/ci-cd.md).
- [Conventional Commits](https://www.conventionalcommits.org/): `feat(extraction): add Jora salary selector`.
- Keep PRs focused; one adapter or one feature per PR is ideal.

## Definition of done

- Tests cover the change (fixture for extraction changes).
- Zero lint warnings, zero type errors.
- Docs updated: the relevant guide/reference page, `CHANGELOG.md`, and
  `npm run docs:sites` when adapters changed.
- No new permission, network request or dependency without discussion (see
  `docs/reference/permissions.md` and ADR-0002).

## Code style

Prettier and ESLint are authoritative; don't hand-format. Prefer small pure
functions, explicit types at module boundaries, and comments that explain
_why_ rather than _what_.
