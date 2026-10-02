# ADR-0013: Offer three plans (Free, Pro, Advanced) with per-plan job limits and local prices

- **Status:** Accepted (replaces the single-paid-plan pricing in ADR-0009)
- **Date:** 2026-10-01

## Context

The owner's pricing and features, 2026-10-01 (revised the same day):

| Plan     | Price                    | Active jobs | Features                                                                                                                                                                                                                                                               |
| -------- | ------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Free     | US$0, no account         | 15          | Capture from every supported site, board, CSV/JSON export, last 30 days of history                                                                                                                                                                                     |
| Pro      | US$7/month, US$59/year   | 45          | Everything in Free, plus: full history (archived and finished jobs, every timeline entry), reminders and closing-date alerts, custom columns, capture from a pasted link, sync across up to 3 computers (no phone). 30-day trial on sign-in, no card                   |
| Advanced | US$15/month, US$159/year | 95          | Everything in Pro, plus: sync across up to 5 devices including phones (the web board), automatic status updates from job emails (ADR-0014), interview details on cards, and all later features (autofill, contacts and documents, analytics, side panel, bulk actions) |

Tips and tricks were dropped.

When a paid plan lapses, the account drops to Free. No data is deleted.

**Revision (2026-10-01): sync is on both paid plans, with device limits.**

- **Pro:** up to 3 computers, meaning signed-in Chrome installs. There's no phone access.
- **Advanced:** up to 5 devices, including phones through the web board.
- `SYNC_DEVICE_LIMITS` in `src/domain/plan.ts` holds the numbers.
- The server enforces them when a device registers (Phase 1c).

**Revision (2026-10-02): features redistributed before launch; Advanced is unlimited.**

Nobody had paid yet, so this was the cheapest moment to change. The owner
approved the following:

- **Rule:** Pro has everything that runs on your computer. Advanced adds
  what runs on our servers (email updates, the web board and phone, more
  devices) and the full side panel.
- **Limits:** Free 15, Pro 60 (was 45), Advanced unlimited (was 95). The
  server's 5,000 synced-job cap (`synced_jobs_cap()`) is the fair-use
  backstop.
- **Moved from Advanced to Pro:** application autofill, Insights, contacts,
  interview rounds and documents with calendar export, and bulk actions.
  All are computed or stored on the device, so they cost nothing to run.
- **Why:**
  - A cap on the top plan penalises the heaviest searchers, who pay the most.
  - Competitors (for example Simplify) give autofill away, so keeping it in
    the top plan wouldn't sell Advanced and left Pro thin at US$7.
- `FEATURE_PLANS` and `allows()` in `src/domain/plan.ts` are the single map
  of feature to plan; gates call `allows(plan, feature)`.
- Prices are unchanged.
- **Trial:** a 14-day trial of Advanced replaces the 30-day Pro trial. People
  try the full product first, then choose a plan or stay on Free. It's still
  one trial per email, with no card (`…_advanced_trial.sql`). Trials already
  running keep their tier.
- A 3-month pass was considered and dropped by the owner.

**Revision (2026-10-02, later): value against the market.** A comparison
showed our paid plans are the cheapest in the category, but our free plan
was the weakest. Huntr's free plan has 100 jobs and autofill, and Teal,
Simplify and Eztrackr track unlimited jobs for free. The owner approved:

- **Free:** 30 active jobs (was 15). Rejected and withdrawn jobs still don't
  count.
- **Basic autofill on every plan:** name, contact details, address and
  links (`BASIC_PROFILE_FIELDS`). Pro (`fullAutofill`) adds the current
  role, work rights, salary, notice period, saved answers and résumé import.
- **Quarterly prices**, billed every 3 months: Pro US$18 / £14 / €16.50 /
  A$26, Advanced US$39 / £31 / €36 / A$59. Every competitor sells a
  quarterly plan, and a median search lasts about 108 days.
  `entitlements.billing_interval` gains `quarter`, and the webhook maps
  "every 3 months" to it.
- **Messaging leads with privacy:** "The private job application tracker:
  no AI reading your applications, no inbox access, no data selling — from
  US$7."

We don't launch until every advertised feature of every plan is built, so
the site advertises them all.

## Decision

- **Plans are data.**
  - `PLANS` and `ACTIVE_JOB_LIMITS` in `src/domain/plan.ts` set 15, 60 and
    unlimited (originally 15, 45 and 95; see the 2026-10-02 revision).
  - A trial or subscription carries a `tier` (`pro` | `advanced`) in
    `entitlements`, set by the billing webhook from the Paddle price.
  - Trials were always Pro; since the 2026-10-02 revision they're 14 days of Advanced.
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
- **Launch gate:** the store listing and live payments wait until every
  advertised feature ships, so the site can list them all. The Chrome Web
  Store's listing rules and Australian consumer law both prohibit selling a
  feature that doesn't exist.
- **History:**
  - Free shows finished (won/lost) jobs and timeline entries from the last
    30 days.
  - Pro and Advanced show everything, including archived jobs.
  - Nothing is ever deleted, and exports always contain everything, so a
    downgrade hides old history but never holds it hostage.

## Consequences

- **Local prices applied:**

  | Price            | UK     | Ireland | Australia |
  | ---------------- | ------ | ------- | --------- |
  | Pro monthly      | £5.50  | €6.50   | A$10.00   |
  | Pro annual       | £48    | €55     | A$89      |
  | Advanced monthly | £11.99 | €13.99  | A$22.99   |
  | Advanced annual  | £129   | €145    | A$239     |

  All are tax-inclusive, as confirmed by Paddle pricing previews. The first
  draft of Advanced monthly (£15/€17.50/A$28) cost more than the US price.

- **Email-parsed status updates** follow ADR-0014: a forwarding address and deterministic rules, no AI vendors.
- **Plan gating uses `planOf()` in the extension and `plan_tier()` on the
  server:** Pro features check `plan !== 'free'`, and Advanced features check
  `plan === 'advanced'`.

## Alternatives considered

- **Limits enforced only on the server:** the board works offline and
  local-first, so the client checks. Server features (sync) will use
  `plan_tier()`, including its per-plan device limit.
- **Upgrades at renewal instead of immediately:** simpler billing, but
  users expect the bigger limit as soon as they pay.
