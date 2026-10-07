# ADR-0037: Run grants, discount codes and referrals from the operations dashboard

- **Status:** Accepted (owner request, 2026-10-07)
- **Date:** 2026-10-07
- The separate decision ADR-0026 asked for before the dashboard takes any
  action. Builds on ADR-0035 (grants, referrals, discount codes).

## Context

The owner wants to run the whole discount, grant and referral programme from
operations.rolestash.com instead of scripts and SQL, and a dashboard that is
calmer and more useful day to day. ADR-0026 made the dashboard read-only and
said any action needs a write-scoped token, an "are you sure" step showing the
exact effect, and an audit log row.

## Decision

1. **Actions, behind the same Access check.** The Worker accepts POSTs only
   from its own pages: Cloudflare Access plus the Worker's JWT check (as
   today), the request's `Origin` must be operations.rolestash.com, and every
   form carries a CSRF token (an HMAC of the signed-in email and the time,
   valid for an hour, with the Worker's admin secret). No JavaScript.
2. **Two steps for every change.** A form leads to a preview page that states
   the exact effect ("Pro for dana@example.com until 31 January 2027, applied
   when they first sign in"); a second POST from the preview does it. Grants
   and revokes also ask for the email to be typed again.
3. **Database changes go through one function,** `public.ops_admin(secret,
actor, action, args)`, callable with the publishable key but only with the
   Worker's `OPS_ADMIN_SECRET`, whose SHA-256 sits in
   `private.ops_admin_secret`. It is separate from the read-only
   `OPS_STATS_SECRET`, so a leaked stats secret can change nothing. Every change
   is written to `private.ops_audit` with the Access-verified email.
4. **Paddle changes** (creating and archiving discount codes, the referral
   discount, moving a referrer's renewal) use `PADDLE_API_KEY`, now scoped to
   read everything the panels need plus write Discounts and Subscriptions.
   Each is logged through `ops_admin('audit.log', …)`.
5. **A daily job in the Worker** (a Cloudflare cron trigger) runs the referral
   step and gives paying referrers their month in Paddle (`next_billed_at` one
   month later, no charge); if that fails because the subscription has ended,
   the month becomes a dated grant instead. The database's own daily job
   qualifies referrals and rewards Free referrers even if the Worker's job
   doesn't run.
6. **Customer details appear only where an action needs them:** grant and
   referral lists show emails (the owner typed or needs them); the overview
   stays counts and statuses.
7. **The page:** an overview (what needs attention, key numbers, panels that
   are set up) and four pages: Grants, Discounts, Referrals, Activity. Panels
   without a token collapse into one "Set up" line instead of a card each.

## Consequences

- One place to grant, revoke, create codes, and run referrals, with a log.
- The dashboard can now change paid access and Paddle discounts: Access (one
  seat, emailed code, one-hour sessions), the Worker's own checks and the
  separate admin secret are the boundary, and are tested.
- New owner steps: set `OPS_ADMIN_SECRET` (one command), and give
  `PADDLE_API_KEY` the write scopes above.

## Alternatives considered

- **Scripts only:** works, but the owner asked for the dashboard.
- **The service-role key in the Worker:** simpler, but it can do anything in
  the database; the secret-gated function can do only these actions.
- **A JavaScript single-page app:** more interactive, but needs a looser CSP
  and more code; plain forms are enough for a one-person console.
