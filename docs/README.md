# Rolestash knowledge base

Start with **Architecture → Overview**, then go by task.

## Architecture

- [Overview](architecture/overview.md): layers, entrypoints, data flow, directory map
- [Extraction pipeline](architecture/extraction-pipeline.md): how a page becomes a job

## Decisions (ADRs)

| #                                                           | Decision                                                                |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| [0001](adr/0001-wxt-react-typescript.md)                    | WXT + React + TypeScript + Tailwind                                     |
| [0002](adr/0002-local-first-no-third-parties.md)            | Local-first, no AI, no third-party services                             |
| [0003](adr/0003-layered-extraction.md)                      | Layered, confidence-scored extraction                                   |
| [0004](adr/0004-on-demand-injection-activetab.md)           | On-demand injection with `activeTab`                                    |
| [0005](adr/0005-plain-text-descriptions.md)                 | Store descriptions as plain text, never HTML                            |
| [0006](adr/0006-fractional-ranking.md)                      | Fractional ranking for card order                                       |
| [0007](adr/0007-storage-per-key-with-migrations.md)         | One key per job, versioned migrations                                   |
| [0008](adr/0008-two-repo-release-pipeline.md)               | Two repos, promote the tested commit                                    |
| [0009](adr/0009-accounts-sync-and-billing.md)               | Accounts, sync and billing (Supabase + MoR)                             |
| [0010](adr/0010-rename-to-rolestash.md)                     | Rename the product to Rolestash                                         |
| [0011](adr/0011-accounts-implementation.md)                 | Accounts: small client, server trials, off by default                   |
| [0012](adr/0012-google-sign-in-via-id-token.md)             | Google sign-in via rolestash.com and an ID token; pinned extension ID   |
| [0013](adr/0013-three-plans.md)                             | Free, Pro and Advanced plans; per-plan limits; local prices             |
| [0014](adr/0014-email-status-updates.md)                    | Email status updates via a forwarding address and rules (no AI)         |
| [0015](adr/0015-reminders-alarms-optional-notifications.md) | Reminders on `alarms`, with `notifications` as an optional permission   |
| [0016](adr/0016-sync-protocol.md)                           | Sync through server-checked RPCs, last writer wins, revision cursor     |
| [0017](adr/0017-web-board.md)                               | A phone-first web board at rolestash.com/board/, built in CI            |
| [0018](adr/0018-email-worker-ingest.md)                     | Email Worker with a single-purpose ingest secret, not the service key   |
| [0019](adr/0019-email-shared-learning.md)                   | Shared learning: template fingerprints and HMAC votes, applied in SQL   |
| [0020](adr/0020-application-autofill.md)                    | Autofill: a local profile, deterministic rules, filled only on a click  |
| [0021](adr/0021-side-panel-one-click-access.md)             | One-click access: a docked side panel and a pinned icon, no page widget |
| [0022](adr/0022-account-profile-and-sharing-choice.md)      | Account profile: display name, inline photo, sharing choice at sign-up  |
| [0023](adr/0023-pricing-page-and-website-purchases.md)      | A pricing page with local prices; website purchases matched by email    |

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
- [Updates list ("Notify me at launch")](guides/launch-list.md)
- [Email status updates (engine, fixtures, accuracy)](guides/email-updates.md)
- [Application autofill (rules, fixtures, live checks)](guides/autofill.md)

## Reference

- [Data model](reference/data-model.md)
- [Storage layout & migrations](reference/storage.md)
- [Permissions](reference/permissions.md)
- [Supported sites](reference/supported-sites.md) _(generated)_

## Planning

- [Roadmap](roadmap.md)
