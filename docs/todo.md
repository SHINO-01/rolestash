# Open to-dos

Everything still open, in one place, with who does it. Details live in the
linked guides; tick items here when they're done and move finished work
into the roadmap or changelog. Last reviewed 5 October 2026.

## Owner

- [ ] **Chrome Web Store, v0.4.1 in review:** paste the data disclosures
      from the release repo's `store/listing.md` ("Collected") into the
      dashboard's **Privacy** tab, if not done yet
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

- [ ] **When Google approves 0.4.1:** move the three fixed issues off
      `/known-issues/`, set "Current version" to 0.4.1 and the date
      ([launch.md](guides/launch.md#v041-in-review-to-do)).
- [ ] **Then release v0.4.2** (`npm run release -- patch`): the account
      dialog shows complimentary plans as "complimentary" instead of
      "Renews on 31 Dec 9999" (on `dev` since 50bc3d8).
- [ ] **After Meheraj signs in:** grant complimentary Advanced with reason
      `team` ([backend.md](guides/backend.md#complimentary-access-adr-0025)).
- [ ] **Launch-list wording (owner's call):** the deployed function's
      confirmation emails still promise new subscribers a launch-day email,
      which won't be sent now the announcement is scrapped (2026-10-05).
      Redeploying the function fixes the wording only
      ([launch.md](guides/launch.md#7-going-public)).
- [ ] **By 4 January 2027:** re-check the facts on `/compare/teal/` and
      `/compare/huntr/` and update their "Facts checked" date
      ([website.md](guides/website.md#search)).
- [ ] **Beta quotes:** add real, permitted quotes to the homepage proof
      section as they arrive ([website.md](guides/website.md#rules)).

## Later (not urgent)

- Component tests for the job drawer and popup form (needs React Testing
  Library), and visual regression screenshots in CI ([roadmap](roadmap.md#tech-debt--quality)).
- Operations dashboard actions (refunds, discounts), each with its own
  decision ([ADR-0026](adr/0026-operations-dashboard.md)).
