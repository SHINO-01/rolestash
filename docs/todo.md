# Open to-dos

Everything still open, in one place, with who does it. Details live in the
linked guides; tick items here when they're done and move finished work
into the roadmap or changelog. Last reviewed 9 October 2026.

## Owner

- [ ] **0.6.3 is in store review;** when it's live, approve the waiting
      0.6.5 Release run's Chrome Web Store step
      ([release-backlog.md](release-backlog.md)).
- [ ] **After 0.6.1 is live: make `rolestash` private** (owner, 8 October;
      `rolestash-extension` stays public: its store approval gate and
      environment secrets need a public repo on the current GitHub plan).
      Order: (1) ours: rewrite the Terms "Open source" section and the site
      changelog's repo link; (2) owner: a fine-grained read-only token for
      `rolestash`, saved as a secret in `rolestash-extension`; ours: use it
      for the submodule checkout and tag lookup in its workflows; (3) owner:
      Settings → General → Change visibility; (4) ours: check one CI push and
      one release-repo Integration run. CodeQL stops (paid for private
      repos); Actions has 2,000 free minutes a month.
- [ ] **Problem reports:** check the dashboard's _Problem reports_ page
      now and then (new ones also show under _Needs attention_ and are
      emailed to support).
- [ ] **Leaked password protection:** turn it on (Supabase → Authentication
      → Providers → Email) as soon as the project moves to Pro; Supabase
      offers it on Pro and above only. The other advisor warnings are
      intended ([backend.md](guides/backend.md#database-advisor-findings-we-accept)).
- [ ] **Gmail (ADR-0032):** Google Cloud is done (Gmail API, the
      `gmail.readonly` scope, both redirect URIs, checked working on 6
      October). Brand verification is done, but `gmail.readonly` needs
      its own restricted-scope review: submit it with the answers and video
      in [gmail-verification.md](guides/gmail-verification.md). Until then
      only listed test users can connect, behind Google's "unverified app"
      screen. Release builds show "Connect Gmail" only to accounts with a
      `tester` grant until then (`GMAIL_VERIFIED = false`; the reviewer
      account has one, and its sign-in goes in Google's form). After
      approval, flip `GMAIL_VERIFIED`, revoke the reviewer's grant
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
      there was nothing to move (the one-time move script was removed on
      7 October)
      ([backend.md](guides/backend.md#paddle-live-state)).
- [x] **Paddle tidy-up:** done 6 October. The old Pro prices and the
      Advanced product are archived; only the three US$12 prices are active.
- [ ] **60-second promo videos are ready** (7 October) for social posts, with
      the rock remix: `promo-60.mp4` (1920×1080) and `promo-60-vertical.mp4`
      (1080×1920) in `brag-output-2026-10-06-232216/`, the CTA frame baked in
      as frame 0, plus `-silent` copies of both and `rock-remix.mp3`.
      The music is "Young Black & Rich (Rock Remix)": make sure you have the
      rights to post it, or swap in the platform's own audio (the silent
      copies are there for that). Posting copy and the weekly plan are in
      the owner's private "Rolestash free marketing playbook" doc.
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
- [ ] **Customer emails (ADR-0038):** the migration is applied and
      `launch-list` and `welcome` are redeployed (7 October), and a
      send-only Resend key ("rolestash-ops dashboard (send only)") exists.
      Left: set it on the dashboard,
      `npx wrangler secret put RESEND_SEND_KEY --config infra/ops-worker/wrangler.jsonc`,
      and paste `supabase/templates/sign-in-code.html` into Supabase →
      Authentication → Emails → _Magic Link_ and _Confirm signup_
      ([operations.md](guides/operations.md#customer-emails-adr-0038)).
- [ ] **Two-step sign-in (ADR-0036):** the migration is applied and every
      Edge Function redeployed (7 October; checked live: the API runs
      `public.require_two_step` before each request and answers normally).
      Left: check Authentication → Multi-Factor has **Authenticator app
      (TOTP)** enabled, and paste `supabase/templates/two-step-on.html` /
      `two-step-removed.html` into the _MFA factor enrolled_ / _unenrolled_
      security notices (subjects in `supabase/config.toml`).
- [ ] **Passwords (ADR-0036), Supabase settings** before 0.6.0 ships:
      Authentication → Sign In / Providers → Email: minimum password length
      **12**, and leave "Secure password change" off; URL Configuration →
      Redirect URLs: add `https://rolestash.com/board/**`; Emails: paste
      `supabase/templates/reset-password.html` into _Reset password_
      (subject "Reset your Rolestash password") and
      `supabase/templates/password-changed.html` into _Password changed_
      (subject "Your Rolestash password was changed").
- [ ] **Store releases:** one at a time, in the order of
      [release-backlog.md](release-backlog.md) (0.6.3 in review, 0.6.5 next).
- [ ] **Go public** when the beta is clean: Distribution → Visibility →
      Public ([launch.md](guides/launch.md#7-going-public)).

## Ours

- [ ] **When 0.6.3 is approved:** set "Current version" on `/known-issues/`
      to 0.6.3 and the date.
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

- [ ] **Scan the rest** on Friday 9 October 2026, after 4 pm Sydney (owner's slot; 0.6.0 is packaged): only `supabase/` and `infra/` were scanned. Next,
      scan the extension (`src/`, about 220 files) and `site/assets`
      (locally, with Claude Security). Everything from the first scan is
      fixed and shipped in v0.4.3.

## Later (not urgent)

- Component tests for the job drawer and popup form (needs React Testing
  Library), and visual regression screenshots in CI ([roadmap](roadmap.md#tech-debt--quality)).
- Operations dashboard actions (refunds, discounts), each with its own
  decision ([ADR-0026](adr/0026-operations-dashboard.md)).
