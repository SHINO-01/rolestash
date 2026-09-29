# CI/CD

Two repositories, one path from a commit to the Chrome Web Store. The reasons
behind each choice are in [ADR-0008](../adr/0008-two-repo-release-pipeline.md).

```
SHINO-01/jobtrail (source)                         SHINO-01/jobtrail-extension (package)
───────────────────────────                        ─────────────────────────────────────
push to dev ─┬─ Quality ────────────┐              daily 06:17 Sydney, or "Run workflow"
             ├─ Unit tests ≥90% ────┼─► Promote          │
             └─ E2E + smoke ────────┘    │               ▼
                                         ├─ fast-forward main      Detect newest source tag not yet shipped
                                         └─ new version?                 │
                                            tag vX.Y.Z + GitHub ───────► Verify (audit, build, manifest gate, smoke E2E)
                                            Release (CHANGELOG)          │
                                                                          ▼
                                                                   Pin submodule + CHANGELOG entry → main
                                                                   GitHub Release: zip + SHA256 + provenance
                                                                          │
                                                                          ▼  (manual approval)
                                                                   Chrome Web Store: upload + submit for review
```

## Day to day (source repo)

```bash
git switch dev
# …work, commit…
git push                      # CI runs; if green, main fast-forwards to this commit
```

For bigger changes, branch off `dev` and open a PR into `dev`: the same checks
run on the PR, and merging it pushes to `dev`, which promotes.

## Shipping a release

```bash
git switch dev && git pull
npm run release -- patch      # or minor / major / 1.2.3
# bumps package.json + lockfile, turns "Unreleased" in CHANGELOG.md into the new version
git commit -am "chore(release): v0.1.1" && git push
```

CI promotes the commit and creates tag `v0.1.1` and a GitHub Release. The
extension repo picks it up on its next daily run. To ship now, open
jobtrail-extension → _Actions_ → _Release_ → _Run workflow_. Approve the
_Chrome Web Store_ deployment when asked. Google's review usually takes a few
hours to a few days.

## What each gate checks

| Gate                  | Where     | Checks                                                                                                                                             |
| --------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quality               | source    | Prettier, ESLint (0 warnings, architecture boundaries), `tsc`, `npm audit signatures`, `npm audit --omit=dev --audit-level=high`, production build |
| Unit tests & coverage | source    | 277+ Vitest tests incl. fixture-driven site tests; ≥90% lines/statements/functions and ≥80% branches on `src/{domain,extraction,storage,services}` |
| E2E                   | source    | Playwright: full suite on the test build, `@smoke` suite on the production build                                                                   |
| Promote               | source    | Fast-forward `main` only; tag + release when the version is new and CHANGELOG has an entry                                                         |
| Integration           | extension | Same audits against today's advisory database, production build + zip, manifest policy gate, smoke E2E on the production build                     |
| Release               | extension | Pins the source tag, CHANGELOG entry, GitHub Release with the verified zip, checksums, provenance                                                  |
| Chrome Web Store      | extension | Manual approval, then upload + submit for review                                                                                                   |

Security scanning outside the pipeline: CodeQL (JavaScript/TypeScript and
workflow files), secret scanning with push protection, Dependabot alerts and
security updates, and weekly Dependabot version PRs into `dev`.

## Repository settings (settings as code)

`scripts/setup-github.sh` applies these to both repos and is safe to re-run.
Run `gh auth login`, then `bash scripts/setup-github.sh`:

Source repo:

- Default branch `dev`. Ruleset on `main`: required checks _Quality_,
  _Unit tests & coverage_ and _E2E_, which must come from GitHub Actions; no
  force-push; no deletion. `dev`: no force-push or deletion. `v*` tags:
  immutable.
- Actions: `GITHUB_TOKEN` read-only by default (jobs opt in to write); only
  GitHub-authored actions allowed, pinned to commit SHAs.
- CodeQL default setup, secret scanning + push protection, Dependabot alerts
  and security updates, private vulnerability reporting.

Extension repo: the same Actions restrictions, security features and tag
ruleset; `main` protected from force-push and deletion; environment
`chrome-web-store` restricted to `main` and requiring the owner's approval.
`--store` also prompts for the Web Store credentials (hidden input).

## One-time Chrome Web Store setup

See jobtrail-extension's README → _One-time setup_. In short: upload the
first zip by hand in the developer dashboard to create the listing, create
OAuth credentials, then add them as `chrome-web-store` environment secrets and
set the `CWS_EXTENSION_ID` variable. From then on the publish step runs.

## When something fails

| Symptom                                | Fix                                                                                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Promote fails with "non-fast-forward"  | `main` has a commit `dev` doesn't. Merge `main` into `dev` and push.                                                                      |
| Promote fails "no entry for x.y.z"     | You bumped the version without a CHANGELOG section. Use `npm run release`.                                                                |
| Extension _Integration_ fails on audit | A new advisory. Update the dependency on `dev`, release a patch.                                                                          |
| Manifest policy gate fails             | Permissions changed. If intended, update `policy/manifest-policy.json` in the extension repo in a reviewed commit, then re-run _Release_. |
| Web Store rejects the upload           | Fix on `dev`, `npm run release -- patch`. Versions can't be reused.                                                                       |
| Bad release is live                    | No rollback exists. Revert on `dev` and release a new patch.                                                                              |
