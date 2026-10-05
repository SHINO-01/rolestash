# Open to-dos

Everything still open, in one place, with who does it. Details live in the
linked guides; tick items here when they're done and move finished work
into the roadmap or changelog. Last reviewed 6 October 2026.

## Owner

- [ ] **One paid plan (ADR-0029), live side.** The US$12 Pro prices exist in
      live Paddle (created 6 October). In this order:
  1. `npx supabase secrets set PADDLE_PRICE_PRO_MONTHLY=pri_01m46d6r756r2swxzfz1zsrwgt PADDLE_PRICE_PRO_QUARTERLY=pri_01m46d6rvpxtwwykg397j0rfam PADDLE_PRICE_PRO_YEARLY=pri_01m46d6scqqy0stz0hwcwsxm40`
  2. `npx supabase functions deploy --project-ref fhclnxqumcdsqxyunelp --no-verify-jwt`
  3. `npx supabase db push` (moves stored `pro` tiers to the full plan)
  4. `npx tsx scripts/paddle-migrate-legacy.ts production` (dry run). Anyone
     listed bought at the old price; email them 30 days' notice (the terms
     promise it), then run it with `--apply`.
- [ ] **Ship v0.4.4** (one Pro plan, the floating widget; ADR-0029, ADR-0030),
      after the steps above:
  1. In rolestash-extension, merge the `release-0.4.4-widget` PR (policy:
     job-site host permissions and the widget's content script; listing;
     screenshots). Its Integration check passes once the source tag v0.4.4
     exists.
  2. Run _Release_ there. The upload asks for new permissions, so expect a
     longer Web Store review.
  3. Copy `store/listing.md` into the dashboard by hand (description,
     permission justifications, screenshot 4 is now the widget).
  4. After it's live: existing users see Chrome's "new permissions"
     prompt once and approve it to keep Rolestash on.
- [ ] **Chrome Web Store:** v0.4.3 (security fixes) is published, 5
      October. Check the **Privacy** tab still has the data disclosures from
      the release repo's `store/listing.md` ("Collected")
      ([launch.md](guides/launch.md#v041-in-review-to-do)).
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

- [ ] **0.4.1 is approved:** move the three fixed issues off
      `/known-issues/`, set "Current version" to 0.4.1 and the date
      ([launch.md](guides/launch.md#v041-in-review-to-do)). When 0.4.2 is
      approved, set it to 0.4.2.
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
