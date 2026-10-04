# ADR-0026: An owner-only operations dashboard at operations.rolestash.com

- **Status:** Accepted (owner, 2026-10-05); built in `infra/ops-worker/`, setup in [guides/operations.md](../guides/operations.md)
- **Date:** 2026-10-04

## Context

Running Rolestash means checking five dashboards: Supabase (accounts,
subscriptions), Paddle (revenue, refunds, disputes, discounts), Resend
(email delivery), Search Console (search traffic), Cloudflare (site health)
and, later, ad accounts. The roadmap asks for one page that shows what needs
attention, for the owner only.

Constraints from AGENTS.md and the privacy policy:

- **No analytics.** rolestash.com promises "no cookies and no analytics".
  The dashboard must not add tracking to the site or the extension. It may
  read numbers that providers already hold (Cloudflare's own request counts,
  Search Console), because that adds no collection on our side.
- **Least privilege.** Every token is read-only where the provider allows
  it, and lives only on the server.
- **Live money.** Paddle is live. The first version takes no actions.
- **Low overhead.** One maintainer: no new database, no new vendor.

## Decision

### Shape

- A **Cloudflare Worker** (`rolestash-ops`), separate from the site Worker,
  on the custom domain `operations.rolestash.com`. It renders one
  server-side HTML page with the site's CSS; no client-side framework and
  no third-party scripts (CSP `default-src 'none'`).
- **Cloudflare Access** in front of the whole hostname: an Access
  application allowing only the owner's email, with Google or one-time-PIN
  login. The Worker also verifies the `Cf-Access-Jwt-Assertion` header
  against the Access team's keys and the application's audience, so the
  Worker refuses requests that didn't come through Access. Access is free
  for up to 50 users.
- **No storage of its own.** Each view fetches from the providers when it
  loads (8-second timeout per panel, no cache), so nothing personal is copied
  anywhere new and the numbers are always current.
- **Deployed by CI** like the site, from `infra/ops.wrangler.jsonc`, after
  the tests pass.

### Version 1: read-only

| Panel          | Source and access                                                                                                                              | Shows                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Accounts       | A new Edge Function `ops-stats` that returns counts only. The Worker calls it with a shared secret; the service role key never leaves Supabase | Accounts, active trials, paid plans by tier, complimentary grants, sign-ups this week     |
| Revenue        | Paddle API, read-only API key (subscriptions, transactions, adjustments: read)                                                                 | MRR, new and cancelled subscriptions, refunds, open disputes, active discounts            |
| Email          | Resend API (domains, emails: read)                                                                                                             | Sent, bounced and complained in the last 7 days; domain status                            |
| Search         | Search Console API, a service account added to the property as a restricted user                                                               | Clicks, impressions and top queries for the last 28 days; sitemap status                  |
| Site           | Cloudflare GraphQL Analytics, a token with Zone Analytics: Read for rolestash.com only                                                         | Requests, 5xx errors and blocked threats per day (edge counts; no visitor tracking added) |
| Product health | GitHub API, a fine-grained read-only token                                                                                                     | Last CI and release runs, open Dependabot alerts                                          |

Personal data stays out of the page: counts and statuses, not names or email
addresses. To look up one customer, the page links to that customer in
Paddle's or Supabase's own dashboard.

### Later, each with its own decision

- **Actions** (issue a refund, create a discount, extend a grant): each needs
  a write-scoped token, an "are you sure" step showing the exact effect, and
  an audit log row. A separate ADR before any of them.
- **Ad accounts** (Google Ads needs a developer token and approval): once we
  run ads.

## Consequences

- One bookmark replaces six dashboards for a daily check.
- New secrets to look after: four read-only tokens and the `ops-stats`
  shared secret in the ops Worker's secrets, rotated when someone leaves or every 12 months. None of them can
  move money or send email.
- Access becomes part of the security boundary: its policy and the Worker's
  JWT check both need tests (a request without a valid assertion gets 403).
- The privacy policy needs no change: nothing new is collected from
  visitors or users.

## Alternatives considered

- **A page inside the web board, gated by an admin flag:** puts admin code
  and tokens next to customer code, and one RLS mistake exposes them.
- **A hosted BI tool (Metabase, Retool):** another vendor holding our
  tokens and data, and a monthly cost.
- **Just bookmarks:** free, but the point is seeing what needs attention
  without opening six tabs.

## As built (2026-10-05)

- Panels for Paddle, Resend, Search Console, Cloudflare and GitHub, each
  "Not set up" until its token is added. The Worker deploys inert: it needs
  the Access application, its AUD tag and the `OWNER_EMAILS` secret.
- **Accounts panel: not built yet.** Reading account counts with the
  Worker's own secret needs a database function callable with the public
  key plus that secret (the email-ingest pattern). That grant is a separate
  owner decision; until then the panel links to the Supabase dashboard.
- **Resend has no read-only key.** Its panel stays "Not set up" unless the
  owner accepts a separate Full-access key (guides/operations.md).

## Owner decisions needed (original)

1. Approve the read-only first version and the panels above (drop any?).
2. Which Access login: Google (your account) or an emailed one-time PIN?
3. Create the read-only tokens when we build it (we'll list exact scopes).
