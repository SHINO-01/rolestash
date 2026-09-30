## What & why

<!-- One or two sentences. Link the issue or ADR if there is one. Target branch: dev. -->

## Checklist

- [ ] `npm run verify` passes locally
- [ ] Tests added or updated (new site adapter → fixture + test)
- [ ] Docs updated (`docs/`, `CHANGELOG.md` under Unreleased, `npm run docs:sites` if adapters changed)
- [ ] Storage schema changed? → migration + backup upgrade + `docs/reference/storage.md`
- [ ] New permission? → justified in `docs/reference/permissions.md` **and** rolestash-extension's `policy/manifest-policy.json`
