# Rolestash knowledge base

Start with **Architecture → Overview**, then go by task.

## Architecture

- [Overview](architecture/overview.md): layers, entrypoints, data flow, directory map
- [Extraction pipeline](architecture/extraction-pipeline.md): how a page becomes a job

## Decisions (ADRs)

| #                                                   | Decision                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------- |
| [0001](adr/0001-wxt-react-typescript.md)            | WXT + React + TypeScript + Tailwind                                   |
| [0002](adr/0002-local-first-no-third-parties.md)    | Local-first, no AI, no third-party services                           |
| [0003](adr/0003-layered-extraction.md)              | Layered, confidence-scored extraction                                 |
| [0004](adr/0004-on-demand-injection-activetab.md)   | On-demand injection with `activeTab`                                  |
| [0005](adr/0005-plain-text-descriptions.md)         | Store descriptions as plain text, never HTML                          |
| [0006](adr/0006-fractional-ranking.md)              | Fractional ranking for card order                                     |
| [0007](adr/0007-storage-per-key-with-migrations.md) | One key per job, versioned migrations                                 |
| [0008](adr/0008-two-repo-release-pipeline.md)       | Two repos, promote the tested commit                                  |
| [0009](adr/0009-accounts-sync-and-billing.md)       | Accounts, sync and billing (Supabase + MoR)                           |
| [0010](adr/0010-rename-to-rolestash.md)             | Rename the product to Rolestash                                       |
| [0011](adr/0011-accounts-implementation.md)         | Accounts: small client, server trials, off by default                 |
| [0012](adr/0012-google-sign-in-via-id-token.md)     | Google sign-in via rolestash.com and an ID token; pinned extension ID |
| [0013](adr/0013-three-plans.md)                     | Free, Pro and Advanced plans; per-plan limits; local prices           |
| [0014](adr/0014-email-status-updates.md)            | Email status updates via a forwarding address and rules (no AI)       |

New decision? Copy [the template](adr/0000-template.md).

## Guides (how-to)

- [Development setup & workflow](guides/development.md)
- [CI/CD pipeline](guides/ci-cd.md)
- [Adding or fixing a site adapter](guides/adding-a-site-adapter.md)
- [Debugging a bad capture](guides/debugging-extraction.md)
- [Adding a feature](guides/adding-a-feature.md)
- [Testing](guides/testing.md)
- [Releasing](guides/releasing.md)
- [Website (rolestash.com)](guides/website.md)
- [Backend (Supabase + Paddle)](guides/backend.md)

## Reference

- [Data model](reference/data-model.md)
- [Storage layout & migrations](reference/storage.md)
- [Permissions](reference/permissions.md)
- [Supported sites](reference/supported-sites.md) _(generated)_

## Planning

- [Roadmap](roadmap.md)
