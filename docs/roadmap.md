# Roadmap

Rolestash is a freemium product with three plans (ADR-0013):

| Plan     | Price                | Active jobs | Features                                                                                                                                                                            |
| -------- | -------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Free     | US$0, no account     | 15          | Capture from every supported site, board, CSV/JSON export, last 30 days of history                                                                                                  |
| Pro      | US$7/mo · US$59/yr   | 45          | Everything in Free, plus: full history, reminders and closing-date alerts, custom columns, capture from a pasted link, sync on 3 computers. 30-day trial                            |
| Advanced | US$15/mo · US$159/yr | 95          | Everything in Pro, plus: sync on 5 devices incl. phone (web board), email status updates and interview cards, autofill, contacts and documents, analytics, side panel, bulk actions |

Local prices in the UK, Ireland and Australia. Every item follows AGENTS.md:
no AI/LLM vendors, local-first, least privilege, and near-zero running cost
until revenue arrives.

**Launch rule:** no public store listing and no live payments until every
feature on the pricing page is built. The site already advertises them all.

## Done

- **Capture and board (v0.1.0):**
  - capture engine with 50 site adapters;
  - Kanban board;
  - JSON backups.
- **Brand:** Rolestash, with rolestash.com (ADR-0010).
- **Website:** rolestash.com with pricing, legal pages and checkout, deployed
  by CI.
- **Accounts and billing** (ADR-0009, 0011, 0012, 0013):
  - Sign-in with an email code, or with Google through rolestash.com.
  - A 30-day Pro trial.
  - Per-plan limits of 15, 45 and 95.
  - Paddle: checkout bound to the account email, billing portal, plan
    changes, signed webhooks and local prices.
  - Account deletion.
  - Everything is off in release builds until launch.

## Phase 1b: Free and Pro features

- ~~**CSV export** (Free)~~ done: board menu → _Export to CSV_ (`src/storage/csv-export.ts`).
- ~~**History**~~ done (`src/domain/history.ts`, board → _History_; archive from a job's
  menu) (Free: 30 days; Pro: everything):
  - an Archive action and an archived view;
  - a finished-jobs view (won and lost);
  - timeline entries older than 30 days behind Pro.
  - Exports always include everything.
- ~~**Reminders and closing-date alerts**~~ done (ADR-0015; the drawer's _Follow-up_,
  board menu → _Closing-date alerts_) (Pro):
  - a `followUpAt` field, with a migration;
  - `chrome.alarms` + `chrome.notifications` (new permissions, with
    justifications);
  - a daily "closing soon" digest.
- ~~**Custom columns**~~ done (board menu → _Edit columns…_; `src/domain/columns.ts`)
  (Pro): rename, recolor, reorder, add and archive stages. Stages are already
  data in settings.
- ~~**Capture from a pasted link**~~ done (_Add job_ → _Fill in from link_;
  `src/services/link-capture-service.ts`) (Pro):
  - `optional_host_permissions` per site;
  - `fetch` + `DOMParser` in an offscreen document, running the same pure
    extractor;
  - a background tab as the fallback for JavaScript-rendered pages.
- ~~**Quality:**~~ done 2026-10-01 (`scripts/snapshot-job-page.ts`, `live-2026-10` fixtures). Verify adapters against live sites. Replace synthetic
  fixtures with scrubbed real snapshots, starting with LinkedIn, SEEK,
  Indeed, Greenhouse, Lever and Workday.

## Phase 1c: Advanced features

- ~~**Sync across devices**~~ done (ADR-0016; Account → _Sync this browser_):
  - Supabase `jobs` and `settings` tables, with RLS for paid plans;
  - a device registry enforcing `SYNC_DEVICE_LIMITS`: Pro up to 3 computers,
    Advanced up to 5 devices including the web board;
  - a `SyncService` behind a `RemoteJobStore` port;
  - last writer wins per job, tombstones for deletes, compressed
    descriptions.
- ~~**Web board**~~ done (ADR-0017; rolestash.com/board/): a phone-first board with
  Today, columns, quick updates and quick add, syncing as a `web` device.
- ~~**Email status updates and interview cards**~~ done (ADR-0014, 0018, 0019):
  - ~~a personal `@in.rolestash.com` address~~ done (`my_inbox`,
    `rotate_inbox`);
  - ~~a Cloudflare Email Worker~~ done (`infra/email-worker/`, ADR-0018;
    live once the owner turns on Email Routing);
  - ~~a deterministic intent engine with an email fixture suite~~ done
    (`src/email/`, 43 fixtures; [guide](guides/email-updates.md));
  - ~~suggestions for low-confidence results~~ done (Accept / Dismiss on
    the card; Unsorted updates);
  - ~~Join, map and add-to-calendar actions on cards~~ done.
  - ~~accuracy work (ADR-0014 §5)~~ done: posting-link, thread and taught
    matching, per-recruiting-system template readers, negation and
    conditional scopes, and a CI gate on the corpus (every expected action,
    100% precision for automatic changes);
  - ~~a shared knowledge base (§6)~~ done (ADR-0019): sender domain →
    company and template fingerprints, promoted after 3 distinct
    confirmations, with no personal data.
- ~~**Application autofill:**~~ done (ADR-0020; [guide](guides/autofill.md)): a local profile and deterministic field mapping
  for Greenhouse, Lever, Workday, Ashby and SmartRecruiters.
- ~~**Contacts, interview notes and documents**~~ done: per job (file names, not
  uploads), plus an `.ics` export.
- **Analytics:** funnel by stage, response time, source site, applications
  per week.
- **Side panel** (`chrome.sidePanel`) and **bulk actions** (multi-select,
  archive, tag).

## Phase 1d: Launch

1. **Paddle live:**
   - account approval;
   - live products, prices and local prices;
   - the live webhook;
   - `PADDLE_ENV=production`;
   - the live client token in `site/assets/pay.js`.
2. **Chrome Web Store:**
   - one-time setup and an unlisted first upload, to get the store ID;
   - add that ID to `ROLESTASH_EXTENSION_IDS` in
     `src/services/web-handoff.ts` **and** to `site/assets/auth-google.js`
     (a test keeps the two lists equal);
   - point the plan CTAs on rolestash.com (now `/#notify`) at the store
     listing;
   - accounts build variables in the extension repo's release workflow;
   - a manifest policy covering `identity`, `alarms`, `notifications` and
     the optional hosts;
   - the listing text and new screenshots.
3. **Privacy:** rewrite PRIVACY.md and the store privacy disclosure to match
   what ships.
4. **Google brand verification** (name and logo on the consent screen).
5. **Beta, then public:** an unlisted beta with 10–20 testers, then the
   public listing.

## Later

- Edge and Firefox builds.
- An opt-in end-to-end encrypted "vault" for synced data (its own ADR).
- A coach/team plan.
- Referral: give a month, get a month.
- Optional on-device assist with Chrome's built-in AI (no vendor), for
  example re-checking low-confidence email updates.

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
