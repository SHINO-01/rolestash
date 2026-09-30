# ADR-0013: Offer three plans (Free, Pro, Advanced) with per-plan job limits and local prices

- **Status:** Accepted (replaces the single-paid-plan pricing in ADR-0009)
- **Date:** 2026-10-01

## Context

The owner's pricing, 2026-10-01:

| Plan     | Price                    | Active jobs | Extras                                                          |
| -------- | ------------------------ | ----------- | --------------------------------------------------------------- |
| Free     | US$0, no account         | 15          | Capture from every supported site, CSV/JSON export              |
| Pro      | US$7/month, US$59/year   | 45          | Full history, tips and tricks. 30-day trial on sign-in, no card |
| Advanced | US$15/month, US$159/year | 95          | Automatic status updates parsed from job emails                 |

Paid plans that lapse drop to Free. No data is deleted or locked.

## Decision

- **Plans are data.**
  - `PLANS` and `ACTIVE_JOB_LIMITS` in `src/domain/plan.ts` set 15, 45 and 95.
  - A trial or subscription carries a `tier` (`pro` | `advanced`) in
    `entitlements`, set by the billing webhook from the Paddle price.
  - Trials are always Pro.
  - `plan_tier()` is the server-side twin, for RLS on tier-gated tables.
- **Limits apply only to creating jobs, at the current plan's limit.**
  - After a downgrade every job stays and stays editable. Only new jobs
    are blocked while the account is at or over its plan's limit.
  - The owner's note said "more than 25". We use the Free limit (15),
    because 25 was the old free limit.
- **Checkout and plan changes:**
  - `create-checkout` takes `{ tier, interval }`.
  - `change-plan` moves a live subscription to another price with
    `prorated_immediately`. Upgrades and downgrades take effect at once,
    and Paddle charges or credits the difference.
- **Local prices are Paddle `unit_price_overrides` on each price**, in GBP
  (UK), EUR (Ireland) and AUD (Australia).
  - Prices use Paddle's `location` tax mode, so in those countries the
    listed amount _includes_ VAT/GST. That's what consumers there expect,
    and in Australia it's the law. US customers pay tax on top.
  - The starting amounts are the owner's; see "Consequences" for the review.
- **Features not built yet are labelled "coming soon" wherever they're
  sold:** on the site, in the extension, and in the Terms, which say they
  aren't part of what you pay for until released. Selling unreleased
  features as available would breach the Chrome Web Store's listing rules
  and Australian consumer law.

## Consequences

- **Price review.** Paddle's sandbox has the owner's amounts, all
  tax-inclusive locally. The Advanced **monthly** overrides cost more than
  the US price after conversion (about US$19–20 in each country), while Pro
  and Advanced annual cost less. That looks unintended. Suggested:

  | Price            | Owner                | Suggested                 |
  | ---------------- | -------------------- | ------------------------- |
  | Pro monthly      | £5.50 / €6.50 / A$10 | keep                      |
  | Pro annual       | £48 / €55 / A$89     | keep                      |
  | Advanced monthly | £15 / €17.50 / A$28  | £11.99 / €13.99 / A$22.99 |
  | Advanced annual  | £129 / €145 / A$239  | keep                      |

- **The email-parsed status updates need their own design before any
  code**, in a separate ADR:
  - Reading Gmail through Google's API requires a _restricted_ scope. That
    means Google's annual security assessment (CASA), which costs hundreds
    to thousands of dollars.
  - The zero-cost alternative is a personal forwarding address per user
    (e.g. `u-…@in.rolestash.com`), handled by a Cloudflare Email Worker and
    parsed with deterministic rules, no AI.
  - Either way the privacy policy must change first.
- The roadmap's Phase 1b features (sync, reminders, custom columns, capture
  from a pasted link) are not placed in a plan yet. They're marked "coming
  soon" on the site until the owner decides.

## Alternatives considered

- **Limits enforced only on the server:** the board works offline and
  local-first, so the client checks. Server features (sync) will use
  `plan_tier()`.
- **Upgrades at renewal instead of immediately:** simpler billing, but
  users expect the bigger limit as soon as they pay.
