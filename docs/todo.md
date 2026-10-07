# Open to-dos

Everything still open, in one place, with who does it. Details live in the
linked guides; tick items here when they're done and move finished work
into the roadmap or changelog. Last reviewed 7 October 2026.

## Owner

- [ ] **v0.4.7 is in Chrome Web Store review** (submitted 6 October; 0.4.3
      stays live until then). After approval, check the dashboard's
      **Privacy** tab and listing match the release repo's
      `store/listing.md` ([launch.md](guides/launch.md#v047-in-review-to-do)),
      then ship the next release in [release-backlog.md](release-backlog.md).
- [ ] **Gmail (ADR-0032):** Google Cloud is done (Gmail API, the
      `gmail.readonly` scope, both redirect URIs, checked working on 6
      October). Waiting on Google's restricted-scope verification; until then
      only listed test users can connect. After approval, set the
      rolestash-extension repository variable `WXT_GMAIL_CLIENT_ID` =
      `681262997873-d085gg7n42vd4b5tl8q68ri8jm8i0vhe.apps.googleusercontent.com`
      and release. The homepage FAQ already says users can connect Gmail or
      Outlook; if verification drags on, ask us to soften it.
- [ ] **Outlook (ADR-0032):** register the Microsoft Entra app (public
      client, `Mail.Read`), then set `WXT_MICROSOFT_CLIENT_ID` in
      rolestash-extension
      ([email-updates.md](guides/email-updates.md#connected-mailbox-gmail-or-outlook-adr-0032)).
- [x] **One paid plan (ADR-0029), live side:** done 6 October. The
      `PADDLE_PRICE_PRO_*` secrets hold the US$12 prices, every function was
      redeployed with `--no-verify-jwt`, migration `20261020120000` is
      applied, and the `paddle-setup.ts` dry run says production is in place.
      No legacy subscribers (the only paid entitlement is the owner's
      complimentary one; the owner's test purchase was refunded), so
      `paddle-migrate-legacy.ts` has nothing to move
      ([backend.md](guides/backend.md#paddle-live-state)).
- [x] **Paddle tidy-up:** done 6 October. The old Pro prices and the
      Advanced product are archived; only the three US$12 prices are active.
- [ ] **60-second promo videos are ready** (7 October) for social posts, with
      the rock remix: `promo-60.mp4` (1920×1080) and `promo-60-vertical.mp4`
      (1080×1920) in `brag-output-2026-10-06-232216/`, the CTA frame baked in
      as frame 0 and `promo-60.jpg` / `promo-60-vertical.jpg` as covers.
      The music is "Young Black & Rich (Rock Remix)": make sure you have the
      rights to post it, or swap in the platform's own audio (the silent
      copies are there for that). A caption is in `share-copy.txt`. The 45 s cuts (`brag.mp4`, `brag-vertical.mp4`) were
      re-rendered with the four lanes too.
- [ ] **Beta:** send the unlisted store link to 10–20 testers; ask for honest
      Chrome Web Store reviews, and whether they're happy to be quoted on
      the homepage ([launch.md](guides/launch.md#6-beta-owner-with-us)).
- [ ] **Operations dashboard sign-in:** the dashboard said "Not allowed."
      on 7 October because Access kept a sign-in older than the Worker's
      one-hour limit. It now offers "Sign out" and a fresh code instead. In
      Zero Trust, set the application's
      login method to One-time PIN only (Instant Auth off), its session
      duration to 1 hour, and the global session timeout to 1 hour
      ([operations.md](guides/operations.md#sign-in-policy-an-emailed-code-at-most-an-hour)).
- [ ] **Operations dashboard tokens**, one per panel: `PADDLE_API_KEY`,
      `CF_ANALYTICS_TOKEN`, `GITHUB_TOKEN`, `GOOGLE_SERVICE_ACCOUNT`, and
      optionally `RESEND_API_KEY`
      ([operations.md](guides/operations.md#tokens-one-per-panel-each-optional)).
- [ ] **Search:**
  - Search Console → **Request indexing** for `/job-sites/`,
    `/private-job-tracker/`, `/australia/`, `/guides/track-job-applications/`,
    `/compare/teal/` and `/compare/huntr/`;
  - check the `sitemap.xml` status turns to Success (it said "Couldn't
    fetch" on 4 October although Google's live test fetched it);
  - add the site to **Bing Webmaster Tools** and submit
    `https://rolestash.com/sitemap.xml` (Bing feeds ChatGPT and Copilot
    search);
  - check Cloudflare's **Block AI bots / AI Crawl Control** is off for
    rolestash.com, if you want AI assistants to cite the site
    ([website.md](guides/website.md#search)).
- [x] **Go-live for grants, discount codes and referrals (ADR-0035,
      ADR-0037):** done 7 October: migrations applied, Edge Functions
      redeployed, the dashboard's admin secret and scoped Paddle key set, the
      50% referral discount `dsc_01m49z0xfn0xmx4dmygft76q15` created and
      referrals turned on.
- [ ] **Customer emails (ADR-0038):** apply the migration, redeploy
      `launch-list`, and set `RESEND_SEND_KEY` (a sending-only Resend key) on
      the dashboard; then grants, new codes, referrals and targeted discounts
      can email customers
      ([operations.md](guides/operations.md#customer-emails-adr-0038)).
- [ ] **Store releases:** one at a time, in the order of
      [release-backlog.md](release-backlog.md) (0.4.7 in review → 0.5.0 →
      0.6.0).
- [ ] **Go public** when the beta is clean: Distribution → Visibility →
      Public ([launch.md](guides/launch.md#7-going-public)).

## Ours

- [ ] **Account security (ADR-0036, accepted 7 October):** being built for
      0.6.0: optional password with a strength check and a reset page
      (`/auth/reset/`), optional two-step sign-in (authenticator app),
      security-change emails and "Sign out everywhere"
      ([ADR-0036](adr/0036-passwords-and-account-security.md)).
- [ ] **When 0.4.7 is approved:** set "Current version" on `/known-issues/`
      to 0.4.7 and the date.
- [ ] **By 4 January 2027:** re-check the facts on `/compare/teal/` and
      `/compare/huntr/` and update their "Facts checked" date
      ([website.md](guides/website.md#search)).
- [ ] **Beta quotes:** add real, permitted quotes to the homepage proof
      section as they arrive ([website.md](guides/website.md#rules)).

## Security

The repo is public, so open security issues are tracked privately, in the
git-ignored `CLAUDE-SECURITY-20261005-025920/OPEN-SECURITY-ISSUES.md` on the
owner's machine (from the scan of `supabase/` and `infra/`, 5 October 2026).
Don't put exploit details in commits, issues or PRs until they're fixed.

- [ ] **Scan the rest** once 0.6.0 is packaged (owner, 7 October): only `supabase/` and `infra/` were scanned. Next,
      scan the extension (`src/`, about 220 files) and `site/assets`
      (locally, with Claude Security). Everything from the first scan is
      fixed and shipped in v0.4.3.

## Later (not urgent)

- Component tests for the job drawer and popup form (needs React Testing
  Library), and visual regression screenshots in CI ([roadmap](roadmap.md#tech-debt--quality)).
- Operations dashboard actions (refunds, discounts), each with its own
  decision ([ADR-0026](adr/0026-operations-dashboard.md)).
