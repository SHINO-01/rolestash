# Releasing

1. Update `version` in `package.json` (semver) — WXT copies it to the manifest.
2. Move _Unreleased_ entries in `CHANGELOG.md` under the new version and date.
3. `npm run verify && npm run test:e2e`.
4. `npm run zip` → `.output/jobtrail-<version>-chrome.zip`.
5. Smoke-test: load `.output/chrome-mv3` unpacked in a clean Chrome profile,
   capture a posting on LinkedIn, SEEK and one ATS, drag it, export a backup.
6. Tag: `git tag v<version> && git push --tags`.
7. Upload the zip in the Chrome Web Store developer dashboard.

## Store listing checklist

- **Single purpose:** "Save job postings to a personal Kanban board."
- **Permission justifications:** copy from [permissions](../reference/permissions.md).
- **Data usage:** "Does not collect or transmit user data" — see `PRIVACY.md`.
- **Remote code:** none.
- Screenshots: board (light + dark), popup, drawer — 1280×800.

## Storage schema changes in a release

If the release contains a migration, test upgrading: install the previous
release, add jobs, then load the new build over the same profile and confirm
the board and an old backup import both work.
