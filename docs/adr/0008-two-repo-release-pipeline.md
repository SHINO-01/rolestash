# ADR-0008: Two repositories, one tested commit, promote don't rebuild

- **Status:** Accepted
- **Date:** 2026-09-30

## Context

The owner wants the code (`SHINO-01/jobtrail`) and the shipped Chrome
extension (`SHINO-01/jobtrail-extension`) in separate repositories, with this
flow: push to `dev` → quality/unit/coverage/integration checks → merge to
`main` → hand the change to the extension repo → health and integration checks
→ package → publish to the Chrome Web Store. Requirements: low overhead, no
over-engineering, better security.

## Decision

**Source repo (`jobtrail`)** — one workflow, `ci.yml`:

1. Push/PR to `dev` runs three parallel jobs: _Quality_ (format, lint with zero
   warnings, typecheck, dependency signature verification, runtime `npm audit`,
   production build), _Unit tests & coverage_ (≥90% line/statement/function
   coverage of the core, 80% branches), _E2E_ (full suite on the test build +
   smoke suite on the production build).
2. On a push to `dev`, if all pass, _Promote_ **fast-forwards** `main` to that
   exact commit. No merge commit, no re-run: `main` only ever contains commits
   that passed.
3. If `package.json` has a version with no tag yet, _Promote_ creates the
   `vX.Y.Z` tag and GitHub Release, with notes taken from `CHANGELOG.md`.
   Ordinary commits reach `main` without releasing; `npm run release -- patch`
   is how a developer asks for a release.

**Extension repo (`jobtrail-extension`)** depends on the source through a
**git submodule** (`source/`) pinned to a release tag. One workflow,
`release.yml`, runs daily and on demand:

1. _Detect_: newest source release tag not yet released here.
2. _Verify_ (reusable `integration.yml`): at that tag, `npm ci`, dependency
   signatures + audit (new advisories since the source was tested), production
   build + zip, **manifest policy gate** (permissions must exactly match
   `policy/manifest-policy.json`), smoke E2E on the production build. Uploads
   the zip.
3. _GitHub Release_: bump the submodule pin, add a `CHANGELOG.md` entry
   generated from the source release notes, commit to `main`, attach the
   **same zip** that was verified, SHA-256 checksums and a build provenance
   attestation.
4. _Chrome Web Store_: in the protected `chrome-web-store` environment
   (manual approval, holds the store credentials), upload the verified zip and
   submit it for review. Skipped until the store listing exists.

## Why these choices

| Choice                                        | Reason                                                                                                                                                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fast-forward promotion instead of PR merge    | Ships the exact tested commit; no merge commits, no second CI run, nothing to click.                                                                                                                  |
| One workflow per repo, jobs chained           | Pushes and tags made with `GITHUB_TOKEN` don't trigger other workflows, so separate "on push to main" workflows would never fire.                                                                     |
| Release on version bump, not every commit     | Every Web Store upload needs a higher version and a review; users shouldn't get an update per commit.                                                                                                 |
| Extension repo pulls tags (daily + manual)    | Needs no cross-repo token. Store review takes days, so a daily poll adds nothing noticeable. Run it manually to ship now.                                                                             |
| Extension repo doesn't re-run lint/unit tests | Already enforced on that exact commit. It checks what can change after the fact (new advisories), what's specific to shipping (manifest policy, prod build smoke test), and builds the artifact once. |
| Submodule instead of npm package              | No registry to publish to. GitHub shows the pin as a link to the exact source commit.                                                                                                                 |
| Publish job runs no source code               | Store credentials never share a job with `npm install` or build scripts from the source repo.                                                                                                         |
| Actions pinned to commit SHAs + Dependabot    | Protects against a compromised action tag; Dependabot keeps pins current.                                                                                                                             |

## Consequences

- `main` in the source repo is never pushed by hand. A ruleset requires the
  three checks before any update to `main`, so only tested commits can land.
  Hotfixes also go through `dev`.
- The Chrome Web Store has no rollback. To undo a release, revert on `dev` and
  release a higher patch version.
- Changing permissions takes two deliberate commits: the source change, then
  the policy file in the extension repo.
- The first Web Store upload is manual (the store needs a listing before the
  API can be used); after that the pipeline publishes.

## Alternatives considered

- **Monorepo:** simplest overall, but the owner asked for two repos. The split
  is kept cheap: no duplicated test runs and no cross-repo secrets.
- **`repository_dispatch` from the source repo:** instant hand-off, but needs a
  long-lived personal access token with write access to the other repo.
- **Dependabot `gitsubmodule` updates:** it tracks branch heads, not release
  tags, so it would propose untested, unreleased commits.
- **release-please / Changesets:** automate versioning with an extra release PR
  to merge. More machinery than `npm run release` for a single-maintainer project.
