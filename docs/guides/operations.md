# Operations dashboard (operations.rolestash.com)

The owner's console ([ADR-0026](../adr/0026-operations-dashboard.md),
[ADR-0037](../adr/0037-dashboard-actions.md)): an overview of what needs
attention across Paddle, Resend, Search Console, Cloudflare, GitHub and the
database, and the pages that run the programmes:

- **Problem reports:** everything sent from _Report a problem_ (ADR-0024),
  newest first: the message, the reply address, the version, browser, plan
  and where it was sent from. Filter by open (new and seen), status or all;
  **Reply by email** opens your mail app addressed to the reporter; mark
  reports seen, fixed or closed, or reopen them (one click, logged). New
  reports show in the side bar and under _Needs attention_. Each report is
  also emailed to support@rolestash.com when it arrives.

- **Grants:** give complimentary Pro (indefinite or until a date) to any
  email, even before they sign up; revoke it, including a grant still
  waiting for sign-up (revoked by its id: a pending grant keeps only a hash
  and a hint of the email, so there's no email to type). Same rules as
  `scripts/grants.ts` (ADR-0035).
- **Discount codes:** create Paddle percentage codes for some or all Pro
  prices (first payment, first 3, or every payment; last day; usage limit),
  copy their promo link (`rolestash.com/pricing/?code=…`), archive them.
- **Referrals:** turn the programme on or off, set the friends' discount,
  see links handed out, pending and rewarded referrals and top referrers,
  void abuse, and run the daily step now.
- **Activity:** every change, who made it, and the result.

Every change is two steps (except a report's status, which is one click and
easily undone): a preview that states the exact effect, then a confirm (grants and revokes also ask you to type the email). Changes are
accepted only from the dashboard's own pages, signed for you, for an hour.

- **Code:** `infra/ops-worker/` (a Cloudflare Worker, `rolestash-ops`), tests
  in `tests/unit/ops-worker/`.
- **Deploy:** CI deploys it after _Promote to main_, like the site. It has no
  routes and no `workers.dev` URL, so it can't be reached until the steps
  below are done.
- **Fails closed:** without `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` and the
  `OWNER_EMAILS` secret, every request gets 403. With them, only requests
  carrying a valid Cloudflare Access token for an allowed email get in.
- **No storage, no scripts, never cached or indexed.** Each load fetches
  fresh numbers (8-second timeout per panel); a slow or failing provider
  shows an error in its own panel only.
- **Changes** go through `public.ops_admin` (database; gated by
  `OPS_ADMIN_SECRET`, logged in `private.ops_audit`) or Paddle's API
  (`PADDLE_API_KEY`, logged the same way).
- **A daily job** (cron, 03:45 UTC) runs the referral step and moves paying
  referrers' next renewal a month out in Paddle, at no charge. The database's
  own job (03:33 UTC) qualifies referrals and rewards Free referrers even
  without it.

## Turning on changes (owner, once)

Done on 7 October 2026.

1. Apply the migrations: `npx supabase db push` (adds the grants, referrals,
   audit log and the `ops_admin` function).
2. Deploy the Edge Functions (create-checkout and paddle-webhook take codes
   and record referrals):
   `npx supabase functions deploy --no-verify-jwt`.
3. Set the admin secret, in one command (needs `SUPABASE_ACCESS_TOKEN` from
   `secrets.env`, and `wrangler login`):

   ```bash
   set -a; . ./secrets.env; set +a
   npx tsx scripts/ops-secret.ts --apply
   ```

   It makes a random value, stores it in the Worker, and only its SHA-256 in
   the database. Run it again to rotate.

4. Give `PADDLE_API_KEY` its scopes (table below), including **Discounts:
   write** and **Subscriptions: write**.
5. On Referrals: create the friends' discount, then turn the programme on.

### Customer emails (ADR-0038)

Steps 1 and 2 done 7 October (the migration as version 20261023120000);
step 3's key exists in Resend, waiting to be set on the Worker.

1. Apply the migration: `npx supabase db push` (adds
   `private.marketing_contacts`, the offer audiences and the opt-out).
2. Redeploy the launch-list function, which handles the opt-out link:
   `npx supabase functions deploy launch-list --no-verify-jwt`.
3. Resend → API Keys → **Create**, permission **Sending access**, domain
   rolestash.com, then
   `npx wrangler secret put RESEND_SEND_KEY --config infra/ops-worker/wrangler.jsonc`.

Then: Grants → Give Pro emails the person (untick "Email them" to skip);
Discount codes → New code can email the code; Referrals → Turn on announces
it; **Emails** sends a targeted discount, emails a live code or announces
referrals. Offers reach each account at most once a week, never after it
opts out, and only people with an account.

## Status and to-do

**Live since 2026-10-05** at https://operations.rolestash.com, behind
Access. Done: the Access application (team `nameless-shadow-4fcf`), its AUD
tag in `wrangler.jsonc`, the `OWNER_EMAILS` secret, the custom domain, the
accounts panel's secret, and the 1-hour sign-in limit in the Worker.

To do (owner): set the sign-in policy below (One-time PIN only, 1-hour
sessions) if not done yet, then add the tokens.

To do (owner), one token per panel, then reload the dashboard:

- [ ] `OPS_ADMIN_SECRET`: `npx tsx scripts/ops-secret.ts --apply` (every change; see "Turning on changes")
- [ ] `PADDLE_API_KEY`: Revenue panel, discount codes and referral rewards (scopes below)
- [ ] `CF_ANALYTICS_TOKEN`: Zone Analytics read for rolestash.com (Site panel)
- [ ] `GITHUB_TOKEN`: fine-grained, Actions and Dependabot alerts read (Product health panel)
- [ ] `GOOGLE_SERVICE_ACCOUNT`: Search Console restricted user (Search panel)
- [ ] `RESEND_API_KEY`: optional; Resend has no read-only key (Email panel)

Scopes and where to create each are in the table below.

## One-time setup (owner)

Do these in order: Access first, so the hostname is protected before it
points at the Worker.

1. **Cloudflare Access application.** Zero Trust (create the team if asked;
   the free plan covers this) → **Access → Applications → Add an
   application → Self-hosted**:
   - domain `operations.rolestash.com`;
   - a policy **Allow**, **Emails**: your email only;
   - login method: Google, or One-time PIN (a code by email);
   - copy the **Application Audience (AUD) Tag**, and note the team domain
     (`<team>.cloudflareaccess.com`, under Settings → Custom pages).
2. **Tell us the AUD tag and team domain.** Both are public values; we put
   them in `infra/ops-worker/wrangler.jsonc` and deploy.
3. **Your email as a secret** (the repo is public, so it isn't committed):

   ```bash
   npx wrangler secret put OWNER_EMAILS --config infra/ops-worker/wrangler.jsonc
   ```

4. **Custom domain:** Workers & Pages → `rolestash-ops` → Settings →
   Domains & Routes → **Add → Custom domain** → `operations.rolestash.com`.
5. **Open** https://operations.rolestash.com, sign in through Access, and
   check every panel says "Not set up" (no tokens yet).

## Sign-in policy: an emailed code, at most an hour

The owner's rule (2026-10-05): every visit after an hour asks for a fresh
one-time code by email. Set it in Cloudflare (Zero Trust):

1. **Access → Applications → operations.rolestash.com → Login methods:**
   tick only **One-time PIN**, untick every other method, and turn
   **Instant Auth** off.
2. Same application → **Session duration: 1 hour**.
3. **Settings → Authentication → Global session timeout: 1 hour.** Access
   keeps a team-wide session too; if it is longer, it can quietly renew the
   app's sign-in without a new code.
4. Check: open the dashboard in a private window; you should get the code
   screen. An hour later, a reload asks again.

The Worker enforces the hour as well: it refuses any Access token whose
sign-in (`iat`) is more than an hour old (`MAX_LOGIN_AGE_SECONDS`), even if
a session setting is changed later.

An emailed code proves you can read that inbox, so the inbox is the real
key: keep 2-Step Verification on that Google account.

## Troubleshooting

- **The marketing site (or its "Page not found") shows instead of the
  dashboard:** a Worker route is catching the hostname. Check Workers &
  Pages → `rolestash-v001` → Domains for any **Route** (such as
  `*.rolestash.com/*`) and delete it; see [website.md](website.md#deployment).
- **"Your sign-in is more than an hour old":** Access's own session outlived
  the Worker's hour (set the session durations above to 1 hour). Follow
  **Sign out**, then open the dashboard again for a new code.
- **"Not allowed." (403):** the Worker refused the Access token. Run
  `npx wrangler tail rolestash-ops` and reload; the log says why
  (`not_allowed`: email not in `OWNER_EMAILS`; `login_too_old`: sign in
  again; `wrong_audience`: AUD tag mismatch).
- **A panel says "Couldn't load (HTTP 401)":** its token is wrong or was
  revoked; create a new one and `wrangler secret put` it again.

## Tokens, one per panel (each optional)

Set each with `npx wrangler secret put <NAME> --config infra/ops-worker/wrangler.jsonc`.
A panel without its token shows "Not set up". Rotate them yearly, and at
once if a laptop or account is lost.

| Secret                   | Where to create it                                                                                                                                                                             | Access it needs                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PADDLE_API_KEY`         | Paddle → Developer tools → Authentication → **New API key**                                                                                                                                    | Read: Transactions, Adjustments, Products, Prices. Read and write: Discounts, Subscriptions (codes, the referral discount, referrers' free months) |
| `CF_ANALYTICS_TOKEN`     | Cloudflare → My Profile → API Tokens → **Create custom token**                                                                                                                                 | Zone → Analytics → Read, for the `rolestash.com` zone only                                                                                         |
| `GITHUB_TOKEN`           | GitHub → Settings → Developer settings → **Fine-grained token**, repos `rolestash` and `rolestash-extension`                                                                                   | Actions: Read, Dependabot alerts: Read (Metadata: Read is implied)                                                                                 |
| `GOOGLE_SERVICE_ACCOUNT` | Google Cloud → enable the **Search Console API** → IAM → Service accounts → create one → Keys → JSON. Then Search Console → Settings → Users and permissions → add its email as **Restricted** | The whole JSON key file as the value; Search Console read-only                                                                                     |
| `RESEND_API_KEY`         | Resend → API Keys                                                                                                                                                                              | **Caution:** Resend has no read-only key; reading needs Full access                                                                                |

**About Resend:** a Full-access key could also send email or change domains.
Leave `RESEND_API_KEY` unset (the panel says "Not set up") unless you accept
that, and if you do, use a separate key named `ops-dashboard` so it can be
revoked on its own.

## The accounts panel's secret

The Worker reads account counts from `public.ops_stats`, using the
publishable key plus its own secret, `OPS_STATS_SECRET`. The database keeps
only that secret's SHA-256 in `private.ops_stats_secret`, and the function
returns counts only. It was set up on 2026-10-05; the secret itself was never
written down. To rotate it (no one needs to know the value):

```bash
SECRET=$(openssl rand -hex 32)
printf '%s' "$SECRET" | npx wrangler secret put OPS_STATS_SECRET --config infra/ops-worker/wrangler.jsonc
printf '%s' "$SECRET" | sha256sum   # then, as the service role:
# insert into private.ops_stats_secret (sha256) values (decode('<hex>', 'hex'))
#   on conflict (id) do update set sha256 = excluded.sha256;
unset SECRET
```

## Staying on Zero Trust Free

The dashboard needs only what the Free plan includes (US$0, up to 50 seats):

- **One seat.** A seat is used by each person who signs in through Access.
  The policy allows your email only, so it stays at one. Check **Zero Trust
  → Settings → Account → Seats**, and remove anyone you don't recognise.
- **One self-hosted Access application** (`operations.rolestash.com`), no
  WARP client, Gateway filtering or tunnels, which the dashboard doesn't use.
- **Logs:** Free keeps Access logs for 24 hours. That's enough: the Worker
  also logs refused requests (reason only) to Workers logs.
- Cloudflare may ask for a payment method when you pick the Free plan; it
  isn't charged unless you change plans or add seats past 50.

## What it shows

| Panel          | Numbers                                                                                                            | Attention when                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| Revenue        | Active, cancelling and past-due subscriptions; sales (7 days); refunds and chargebacks (30 days); active discounts | Anything past due, any chargeback              |
| Email          | Domain status; sent, bounced and spam reports among the latest 100 (7 days)                                        | A bounce, a spam report, a domain not verified |
| Search         | Clicks and views (28 days), top 5 queries, sitemap errors                                                          | A sitemap with errors                          |
| Site           | Requests, 5xx errors and threats blocked (7 days)                                                                  | 5xx above 1%                                   |
| Product health | Latest CI run on `dev`, latest release run, open Dependabot alerts                                                 | A failed run, any open alert                   |
| Headline       | Paying, on trial, accounts (new this week), complimentary (waiting for sign-up), referrals rewarded and pending    | Past due, referral months due, grants ending   |
| Usage          | Devices syncing this week, email update inboxes, news subscribers, problem reports                                 | A new problem report                           |

The overview shows counts and statuses only. Emails appear only where an
action needs them: the grants list, and referrers on the Referrals page
(friends appear as a hint, such as `ja…@gmail.com`). Each panel links to the
provider's own dashboard for a closer look. Panels without a token collapse
into one "Not set up" line.
