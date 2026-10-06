# Open to-dos

Everything still open, in one place, with who does it. Details live in the
linked guides; tick items here when they're done and move finished work
into the roadmap or changelog. Last reviewed 6 October 2026 (night).

## Owner

- [ ] **v0.4.7 is in Chrome Web Store review** (submitted 6 October; 0.4.3
      stays live until then). After approval, check the dashboard's
      **Privacy** tab and listing match the release repo's
      `store/listing.md` ([launch.md](guides/launch.md#v047-in-review-to-do)).
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
- [ ] **Beta:** send the unlisted store link to 10–20 testers; ask for honest
      Chrome Web Store reviews, and whether they're happy to be quoted on
      the homepage ([launch.md](guides/launch.md#6-beta-owner-with-us)).
- [ ] **Operations dashboard sign-in:** in Zero Trust, set the application's
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
- [ ] **Meheraj's complimentary access:** ask them to sign in to Rolestash
      once with meherajrafid@gmail.com, then tell us.
- [ ] **Go public** when the beta is clean: Distribution → Visibility →
      Public ([launch.md](guides/launch.md#7-going-public)).

## Ours

- [ ] **Grants, referrals and discount codes (ADR-0035, proposed):**
      revocable complimentary Pro (indefinite or dated), "give 50%, get a
      month" referrals, and scripted Paddle discount codes with promo links.
      Build order and estimates in [ADR-0035](adr/0035-grants-referrals-discounts.md).
- [ ] **Four board lanes (ADR-0034, accepted):** Saved, Applied,
      Interviewing, Offer on the board; Rejected set from the drawer, no lane;
      Screening and Withdrawn retired. The audit and step-by-step plan are in
      [ADR-0034](adr/0034-four-board-lanes.md); the owner's three answers are recorded there. Ready to build.
- [x] **New launch film:** done 7 October: a 45-second film of all ten
      features (Free, then "That's not all.", then Pro) is the hero, silent,
      landscape and vertical; the music cuts for social are in the brag output
      folder ([website.md](guides/website.md#the-hero-film)).

- [ ] **When 0.4.7 is approved:** set "Current version" on `/known-issues/`
      to 0.4.7 and the date.
- [ ] **After Meheraj signs in:** grant complimentary Advanced with reason
      `team` ([backend.md](guides/backend.md#complimentary-access-adr-0025)).
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

- [ ] **Scan the rest:** only `supabase/` and `infra/` were scanned. Next,
      scan the extension (`src/`, about 220 files) and `site/assets`
      (locally, with Claude Security). Everything from the first scan is
      fixed and shipped in v0.4.3.

## Later (not urgent)

- Component tests for the job drawer and popup form (needs React Testing
  Library), and visual regression screenshots in CI ([roadmap](roadmap.md#tech-debt--quality)).
- Operations dashboard actions (refunds, discounts), each with its own
  decision ([ADR-0026](adr/0026-operations-dashboard.md)).
