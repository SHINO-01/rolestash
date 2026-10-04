# Roadmap

Rolestash is a freemium product with three plans (ADR-0013):

| Plan     | Price                            | Active jobs | Features                                                                                                                                                                                                  |
| -------- | -------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Free     | US$0, no account                 | 30          | Capture from every supported site, board, basic autofill (contact details and links), CSV/JSON export, last 30 days of history                                                                            |
| Pro      | US$7/mo · US$18/qtr · US$59/yr   | 60          | Everything in Free, plus: full autofill, Insights, contacts and documents, bulk actions, full history, reminders and closing-date alerts, custom columns, capture from a pasted link, sync on 3 computers |
| Advanced | US$15/mo · US$39/qtr · US$159/yr | Unlimited   | Everything in Pro, plus: email status updates and interview cards, sync on 5 devices incl. phone (web board), the full side panel. 14-day free trial                                                      |

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
  - A 30-day Pro trial (a 14-day Advanced trial since 2026-10-02).
  - Per-plan limits of 15, 45 and 95 (15, 60 and unlimited since the
    2026-10-02 revision of ADR-0013).
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
- ~~**Analytics**~~ done as **Insights** (`src/domain/insights.ts`, computed on
  the device): applications per week, how far applications get, reply rate
  and typical wait, applications unanswered after 21 days, and results by
  source.
- ~~**Side panel**~~ done (ADR-0021: one-click access, Today and board docked
  beside the page) and ~~**bulk actions**~~ done (select mode or Ctrl/⌘-click;
  move, tag, archive, delete with undo).

## Phase 1d: Launch

Runbook: [guides/launch.md](guides/launch.md).

1. ~~**Paddle live**~~ done (v0.4.0): account approval, live products with
   local and regional prices, the live webhook, `PADDLE_ENV=production` and
   the live client token in `site/assets/pay.js`.
2. **Chrome Web Store:**
   - ~~one-time setup and an unlisted first upload~~ done (item
     `cncilbdakhabnocnjokbonggomndedgp`; v0.4.0 approved and published,
     unlisted, on 2026-10-04; v0.4.1 in review);
   - ~~add that ID to `ROLESTASH_EXTENSION_IDS` in
     `src/services/web-handoff.ts` **and** to `site/assets/auth-google.js`
     (a test keeps the two lists equal)~~ done;
   - ~~point the plan CTAs on rolestash.com at the store listing~~ done
     (live since 2026-10-03; the buttons work once the item is published);
   - ~~accounts build variables in the extension repo's release workflow~~
     done, and automatic store uploads are set up, with a credentials check
     before each upload;
   - ~~a manifest policy covering `identity`, `alarms`, `notifications` and
     the optional hosts~~ done (release repo `policy/manifest-policy.json`);
   - ~~the listing text and new screenshots~~ done (release repo
     `store/`; the first review rejected site names in the description as
     keyword spam).
3. ~~**Privacy:**~~ done: PRIVACY.md, rolestash.com/privacy/ and the store
   disclosure match what ships.
4. ~~**Google brand verification**~~ done (name and logo on the consent
   screen).
5. **Beta, then public:** an unlisted beta with 10–20 testers, then the
   public listing.
   - To do: ask beta testers who are happy to be quoted, and add their words
     to the homepage proof section (the `proof-quote` snippet in
     [guides/website.md](guides/website.md)). Real quotes only, with
     permission.

## Next

- ~~**Launch video**~~ done (2026-10-04): a silent 21-second film in the
  rolestash.com hero, landscape on wide screens and vertical on phones
  ([guides/website.md](guides/website.md)).
- **Operations dashboard** at `operations.rolestash.com` for us: Cloudflare,
  Paddle (refunds, disputes, discounts), Resend, Search Console and ad
  accounts in one place, behind owner-only sign-in. Not urgent; needs a
  short design note first (which APIs, read-only tokens, Cloudflare Access).

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
- ~~Performance check with 1,000+ jobs~~ done: columns show 50 cards at a
  time, and `npm run perf:board` measures it (guides/testing.md). Full
  virtualisation isn't needed yet.
- ~~Sync conflict tests~~ done: two devices editing, deleting and undoing
  offline, with a randomised convergence test (ADR-0016, revised).
