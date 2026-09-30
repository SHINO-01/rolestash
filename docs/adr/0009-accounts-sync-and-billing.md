# ADR-0009: Add accounts, cloud sync and paid subscriptions on Supabase + a merchant of record

- **Status:** Accepted (supersedes the "no backend / no network" parts of ADR-0002)
- **Date:** 2026-09-30

## Context

Rolestash (formerly Jobtrail, ADR-0010) becomes a freemium product:

- a **small free tier**, local-only and with no account needed;
- **Pro at US$7/month**, with a **30-day free trial** that starts when you
  sign in.

That needs user accounts, a way to know who has paid, and Pro features
valuable enough to be worth $7. The owner operates from NSW, Australia. The
owner's constraints:

- Running costs close to zero until revenue arrives; no fixed monthly bills.
- Avoid third-party AI vendors. Extraction stays deterministic (ADR-0003).
- Keep the privacy promise as strong as a paid cloud product allows.
- A single maintainer, so as little infrastructure as possible.

Two facts shape the design:

1. **Both repositories are public.** A paywall enforced only inside the
   extension can be removed by anyone who forks it. Only features that need
   our server can be truly enforced.
2. **Chrome Web Store Payments was retired**, so billing has to come from an
   outside provider. The store listing must say plainly what is paid, that it
   recurs, who the seller is, and how to cancel.

## Decision

### Backend: Supabase (free plan), accessed directly from the extension

One Supabase project provides Postgres, Auth, Row Level Security (RLS), Edge
Functions (billing webhooks) and `pg_cron` (reminder digests). That means no
server of our own.

- **Region:** `ap-southeast-2` (Sydney), close to our first market and
  matching the privacy policy.
- **Postgres** stores accounts, entitlements and synced jobs. Every table has
  RLS set to `auth.uid() = user_id`. The extension only ever holds the public
  anon key.
- **Auth:** "Continue with Google" through `chrome.identity.launchWebAuthFlow`
  (PKCE), plus an email one-time code as a fallback. Auth email goes out over
  custom SMTP (Resend free plan), because Supabase's built-in sender is limited
  to about 2 emails an hour and is meant for testing only.
- **Portability:** we use plain Postgres plus Supabase's standard Auth. A
  `pg_dump` can move the data to Neon or any other Postgres if we have to
  leave.

### Local-first stays the core

- `chrome.storage.local` remains the source of truth. The board works offline
  and without an account.
- Sync is a layer on top: a `SyncService` behind a new `RemoteJobStore` port,
  so `domain/` and `extraction/` stay pure and unit tests stay offline.
  - Push: changed jobs, identified by `updatedAt`.
  - Pull: `updated_at > cursor`.
  - Conflicts: last writer wins per job at first; per-field merge later.
  - Deletes become tombstones.
- Descriptions are stored gzip-compressed on the server so they fit the free
  plan's 500 MB.

### Billing: a merchant of record behind one webhook

- The merchant of record (MoR) is the legal seller. It collects and pays
  sales tax/VAT/GST worldwide, and it handles refunds and chargebacks.
- We never see card data.
- Default MoR: **Paddle**, with **Creem** as the fallback. Both accept
  Australian sellers.
  - Paddle pays out to an Australian bank for free when the balance currency
    matches the bank's (a US$100 minimum per payout).
  - Creem charges the higher of US$7 or 1% on every payout. That outweighs
    its lower per-sale fee until there are about 40 subscribers.
  - Paddle's pricing asks sellers of products under US$10 to contact them.
    If they refuse the $7 price or the account, we use Creem.
- Checkout opens in a normal browser tab. A webhook (Supabase Edge Function)
  verifies the signature and upserts one row into `entitlements`:
  `{ user_id, status, trial_ends_at, current_period_end, provider, provider_customer_id }`.
- Only the webhook knows about the provider, so switching MoR means rewriting
  a single function.

### Trial and access rules

- **The trial starts at sign-up**, with `trial_ends_at` set in our database.
  No card is needed. Our trial is not the MoR's trial feature, so a user
  can't get a new trial by reinstalling.
- The extension caches a **signed entitlement**, a short-lived JWT with an
  entitlement claim. It checks the token offline and allows a 7-day grace
  period with no network.
- **The free tier needs no account.** It includes:
  - capture from every supported site;
  - the board with the default columns;
  - up to **25 active jobs** (jobs in a `lost` stage don't count);
  - JSON/CSV export and import.
- **Pro** adds:
  - unlimited jobs;
  - cloud sync;
  - reminders and digests;
  - custom columns;
  - capture from a pasted link;
  - analytics;
  - autofill;
  - the web board.
- **When Pro lapses, the account drops back to Free. Nothing is locked or
  deleted.**
  - Every job stays visible and editable.
  - New captures are blocked only while more than 25 jobs are active.
  - Sync stops, and the local copy stays.
  - Export and account deletion always work.
  - We never hold data hostage. That protects trust and matches the store's
    honest-marketing policy.
- The limit is a constant in `domain/` (`FREE_ACTIVE_JOB_LIMIT`), so it is
  easy to test and to tune in a release.
- **Server-enforced paid features** are the real paywall: sync, the web
  board, email digests and reminders, and larger history. Paid features that
  run only on the client are gated in good faith; we accept that forks can
  bypass them.

### Network policy (replaces ADR-0002's "no network requests")

The extension may contact only:

- the page the user is on;
- our Supabase project (`https://<ref>.supabase.co`);
- the MoR's hosted checkout and customer portal, opened as tabs and never
  fetched in the background.

Still banned: analytics SDKs, remote config, crash-reporting vendors, CDN
assets and **AI/LLM vendor APIs**. Any future AI feature has to use Chrome's
on-device built-in AI (Gemini Nano via the Prompt API) and must be optional.

### Permissions added

| Permission                           | For                                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| `identity`                           | Google sign-in via `launchWebAuthFlow`                                                  |
| `alarms`, `notifications`            | Follow-up reminders (roadmap)                                                           |
| none for Supabase                    | Supabase sends CORS headers, so extension pages can `fetch` it without host permissions |
| `optional_host_permissions` per site | Capturing from a pasted link, requested when the user first uses it                     |

Each permission is justified in `docs/reference/permissions.md` and in
rolestash-extension's `policy/manifest-policy.json` / `store/listing.md` in the
same release.

## Consequences

- PRIVACY.md changes from "we collect nothing" to an honest account-and-sync
  policy. It is updated in the **same PR** that ships the first network call,
  not before. It lists the data processors: Supabase, the MoR and Resend.
- We need Terms of Service and a refund policy, both hosted on a small static
  site with a domain. MoRs require them to approve an account.
- Supabase's free plan has **no backups** and **pauses after 7 days idle**.
  Local-first limits the damage from the first: every device holds a full
  copy. A scheduled GitHub Action pings the project until there are regular
  users. We move to Pro (US$25/month) when usage nears the limits or about
  10 users are paying, whichever comes first.
- New operational duties: account deletion (GDPR/Australian Privacy Act),
  webhook monitoring, and support email.
- Unit tests stay offline. Sync and billing logic is tested against in-memory
  fakes of the new ports. Integration tests run against `supabase start`
  (a local Docker stack), not the live project.

## Alternatives considered

| Option                                                            | Why not (for now)                                                                                                                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Neon** free (0.5 GB/project, 100 projects, 60k MAU Better Auth) | Same storage for one app. It needs our own API layer (e.g. Cloudflare Workers) for access rules and webhooks, which is more moving parts. It is the planned escape hatch. |
| **Aiven** free Postgres (1 GB, backups)                           | More storage, but no auth, no API and "not aimed at production". Only one free service.                                                                                   |
| Prisma Postgres, CockroachDB, Render                              | Operation-metered, not Postgres-compatible, or expires after 30 days.                                                                                                     |
| **Creem** (3.9% + 40¢; payout fee: higher of $7 or 1%)            | Cheapest per sale, but the fixed payout fee makes it dearer than Paddle below about 40 subscribers. It is the fallback, and we reconsider it at higher volume.            |
| **Polar** (5% + 50¢ free plan, +1.5% international)               | Dearer than Paddle for customers outside the US, and it adds Stripe payout fees ($2/month plus a fee per payout).                                                         |
| **Dodo Payments** (4% + 40¢, plus surcharges)                     | We couldn't confirm in their docs that they pay out to Australian sellers. Their $30 dispute fee is also high.                                                            |
| **Lemon Squeezy** (5% + 50¢)                                      | Same price as Paddle, with recovery surcharges. Its roadmap is uncertain since Stripe bought it.                                                                          |
| **Stripe Billing directly** (~2.9% + 30¢ + 0.7%)                  | Not an MoR, so we would register for and file VAT/GST ourselves in each market. Too much work for one person. Stripe Managed Payments adds 3.5%.                          |
| Client-side end-to-end encryption of synced jobs                  | The strongest privacy, but a lost key means lost data, and it rules out server-side digests and the web board's search. We may revisit it as an opt-in "vault" mode.      |
| `chrome.storage.sync` only (no backend)                           | The 100 KB quota is too small for jobs. There are no accounts, so no way to enforce payment.                                                                              |
