# Releasing

Releases are automated end to end. See [CI/CD](ci-cd.md) for the full pipeline.

1. On `dev`, make sure `CHANGELOG.md` → _Unreleased_ describes the changes.
2. `npm run release -- patch` (or `minor`, `major`, `x.y.z`). This bumps
   `package.json` + `package-lock.json` and dates the changelog section.
3. Commit (`chore(release): vX.Y.Z`) and push to `dev`.
4. CI promotes to `main` and creates tag `vX.Y.Z` + a GitHub Release.
5. rolestash-extension builds, verifies and releases it (daily, or run
   _Release_ manually), then asks for your approval before submitting to the
   Chrome Web Store.

## Versioning

Semantic versioning, and the manifest version equals `package.json`:

- **patch**: fixes, adapter selector updates
- **minor**: new features, new adapters
- **major**: breaking storage/backup format changes (with migrations)

## Storage schema changes in a release

If the release contains a migration, test the upgrade path first. Install the
previous release, add jobs, load the new build over the same profile, and
confirm the board and an old backup import both work.

## Store listing

Listing text, screenshots, permission justifications and the privacy
disclosure live in rolestash-extension under `store/`. To regenerate the
screenshots (1280×800, fictional data), run `npm run store:screenshots` here,
then copy `.output/store-screenshots/*.png` into that repo's
`store/screenshots/`.
