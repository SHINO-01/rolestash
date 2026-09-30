# Roadmap

Jobtrail is moving from a free local tool to **freemium** (ADR-0009):

- **Free:** local-only, no account, up to 25 active jobs.
- **Pro:** US$7/month or US$59/year, with a 30-day trial when you sign in. Every item still follows AGENTS.md:

- no AI/LLM vendors;
- local-first;
- least privilege;
- close to zero running cost until revenue arrives.

Phases are listed in order. Within a phase, items are in priority order.
The Chrome Web Store launch comes at the end of **Phase 1**. We don't list
publicly until billing works, because paying users arriving through reviews
are the launch.

## Phase 1 — Paid launch (v0.2 → v1.0)

### 1a. Accounts, entitlement, billing (the paywall)

- **Supabase project** (free plan).
  - Schema: `profiles`, `entitlements`, `jobs`, `settings`.
  - RLS on every table.
  - SQL migrations in `supabase/migrations/`.
  - `supabase start` for local tests.
- **Sign-in.**
  - Google via `chrome.identity.launchWebAuthFlow` (PKCE), plus an email
    one-time code fallback.
  - Custom SMTP through Resend (free: 3,000 emails/month, 100/day).
- **Free tier and trial.**
  - Enforce `FREE_ACTIVE_JOB_LIMIT` (25) at capture and at manual add, with an
    upgrade prompt.
  - The Pro trial starts at sign-in, with no card.
  - The extension caches a signed entitlement with a 7-day offline grace
    period.
  - The "Trial: N days left" banner and the paywall screen appear on the
    board and in the popup.
- **Checkout.**
  - A merchant of record: **Paddle** by default, **Creem** as the fallback.
  - Monthly **$7** and annual **$59** (two months free).
  - A webhook Edge Function writes `entitlements`.
  - "Manage subscription" opens the MoR's customer portal.
- **Lapsed Pro drops back to Free.** Nothing is locked or deleted; only new
  captures above the limit are blocked.
- **Account deletion** in Settings. It removes the server rows and keeps the
  local data.
- ~~**Legal and store pages.**~~ Done: `site/` (docs/guides/website.md) has
  the landing page, Terms, Privacy, Refunds and Support. Still to do: connect
  Cloudflare Pages; rewrite the extension's PRIVACY.md in the PR that ships
  sync; update the store listing's payment disclosure.
- **Extension repo.** Update `policy/manifest-policy.json` (`identity`,
  `alarms`, `notifications`) and `store/listing.md`.

### 1b. Paid features that justify $7

- **Cloud sync across devices** (server-enforced).
  - A `SyncService` behind a `RemoteJobStore` port.
  - Push and pull by `updatedAt`, tombstones for deletes.
  - Last writer wins per job.
  - Descriptions stored compressed.
- **Follow-up reminders and deadlines.**
  - A `followUpAt` field, with a migration.
  - `chrome.alarms` + `chrome.notifications`.
  - A "closing soon" digest from `closesAt`.
  - An optional weekly email digest via `pg_cron` + Resend
    (server-enforced).
- **Customise columns.** Rename, recolor, reorder, add or archive stages.
  Stages are already data in settings.
- **Paste a link.** Capture a URL without opening it:
  - `optional_host_permissions` per site;
  - `fetch` + `DOMParser` in an offscreen document, running the same pure
    extractor;
  - a background tab as the fallback for JavaScript-rendered pages.
- **Verify adapters against live sites.**
  - Replace the synthetic fixtures with scrubbed real snapshots.
  - Start with LinkedIn, SEEK, Indeed, Greenhouse, Lever and Workday.
  - Set `lastVerified`.
- **CSV export** for spreadsheets. It is included in Free.

### 1c. Launch

- ~~Rebrand to Rolestash~~ Done (ADR-0010): product, icons, docs and both
  GitHub repos.

- One-time Chrome Web Store setup (rolestash-extension README → _One-time
  setup_).
  - The first listing goes in unlisted or with a small audience.
  - Then public.
- Onboarding: sign in, capture your first job, see the board. Include a
  sample-data option.
- Support inbox (email forwarding on the domain, free) and a public
  changelog page.

## Phase 2 — Retention and differentiation (v1.x)

- **Application autofill.** A local profile (name, email, phone, links, work
  rights) and deterministic field mapping for Greenhouse, Lever, Workday,
  Ashby and SmartRecruiters. No AI. This is the most-requested feature in
  this category.
- **Contacts and interviews** per job: recruiter, interview dates, outcomes,
  and an `.ics` export for calendars.
- **Documents.** Record which CV/cover letter version was sent (file names
  and notes, not uploads).
- **Analytics view.**
  - Funnel conversion by stage.
  - Response time.
  - Source site.
  - Applications per week.
- **Web board** (read and edit on a phone). A static site on Cloudflare
  Pages talking to the same Supabase project with RLS. Server-enforced.
- **Side panel** (`chrome.sidePanel`) with the current job's card while
  browsing.
- **Bulk actions**: multi-select, archive, tag.
- **Referral**: give a month, get a month. It costs nothing to run.

## Phase 3 — Reach (v2)

- **Edge and Firefox builds.** WXT supports both; most of the work is
  manifest differences. Edge Add-ons listing is free.
- **Optional on-device assist** via Chrome's built-in AI (Gemini Nano,
  Prompt API): summarise a posting, draft a follow-up note.
  - Runs locally, costs nothing, no vendor.
  - Hidden when the device can't run it.
- **Opt-in end-to-end encrypted "vault" mode** for synced data (a separate
  ADR).
- **Coach/team plan** (career coaches, bootcamps, university careers
  services): shared read access to a client's board.

## Infrastructure cost gates

| Trigger                                                 | Action                                  | Cost              |
| ------------------------------------------------------- | --------------------------------------- | ----------------- |
| Launch                                                  | Domain + Chrome Web Store developer fee | ~US$15 one-off/yr |
| DB > 350 MB, or ~10 paying users, or a need for backups | Supabase Pro                            | US$25/mo          |
| > 100 emails/day                                        | Resend Pro, or send digests in batches  | US$20/mo          |
| > ~40 paying users                                      | Compare Creem and Paddle fees again     | fee saving        |

## Tech debt / quality

- Component tests for the drawer and popup form (React Testing Library).
- Visual regression screenshots in CI.
- Performance check with 1,000+ jobs (virtualised columns if needed).
- Sync conflict tests: two devices editing the same job offline.
