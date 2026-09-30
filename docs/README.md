# Rolestash knowledge base

Start with **Architecture → Overview**, then go by task.

## Architecture

- [Overview](architecture/overview.md): layers, entrypoints, data flow, directory map
- [Extraction pipeline](architecture/extraction-pipeline.md): how a page becomes a job

## Decisions (ADRs)

| #                                                   | Decision                                     |
| --------------------------------------------------- | -------------------------------------------- |
| [0001](adr/0001-wxt-react-typescript.md)            | WXT + React + TypeScript + Tailwind          |
| [0002](adr/0002-local-first-no-third-parties.md)    | Local-first, no AI, no third-party services  |
| [0003](adr/0003-layered-extraction.md)              | Layered, confidence-scored extraction        |
| [0004](adr/0004-on-demand-injection-activetab.md)   | On-demand injection with `activeTab`         |
| [0005](adr/0005-plain-text-descriptions.md)         | Store descriptions as plain text, never HTML |
| [0006](adr/0006-fractional-ranking.md)              | Fractional ranking for card order            |
| [0007](adr/0007-storage-per-key-with-migrations.md) | One key per job, versioned migrations        |
| [0008](adr/0008-two-repo-release-pipeline.md)       | Two repos, promote the tested commit         |
| [0009](adr/0009-accounts-sync-and-billing.md)       | Accounts, sync and billing (Supabase + MoR)  |
| [0010](adr/0010-rename-to-rolestash.md)             | Rename the product to Rolestash              |

New decision? Copy [the template](adr/0000-template.md).

## Guides (how-to)

- [Development setup & workflow](guides/development.md)
- [CI/CD pipeline](guides/ci-cd.md)
- [Adding or fixing a site adapter](guides/adding-a-site-adapter.md)
- [Debugging a bad capture](guides/debugging-extraction.md)
- [Adding a feature](guides/adding-a-feature.md)
- [Testing](guides/testing.md)
- [Releasing](guides/releasing.md)

## Reference

- [Data model](reference/data-model.md)
- [Storage layout & migrations](reference/storage.md)
- [Permissions](reference/permissions.md)
- [Supported sites](reference/supported-sites.md) _(generated)_

## Planning

- [Roadmap](roadmap.md)
