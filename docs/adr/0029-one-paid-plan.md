# ADR-0029: Merge Pro and Advanced into one Pro plan at US$12

- **Status:** Accepted
- **Date:** 2026-10-06
- **Live:** 2026-10-06 (Supabase secrets, functions and migration `20261020120000`)
- Supersedes the plan split in ADR-0013 (its 2026-10-02 redistribution).

## Context

Two paid plans (Pro US$7 with 60 jobs and on-device features, Advanced US$15
with unlimited jobs and the server features) made the pricing page, the
account dialog and the upgrade prompts harder to read, and split the one
thing people pay for (a tracker that keeps itself up to date) across two
price points. The owner decided on one paid plan.

## Decision

- **Plans:** Free (30 active jobs) and **Pro**, which has everything Advanced
  had: unlimited jobs, email status updates, full autofill, Insights, records,
  bulk actions, reminders, full history, and sync on 5 devices including the
  web board. The 14-day trial is of Pro.
- **Price:** US$12 a month, US$30 every 3 months, US$99 a year. Every local
  price in `scripts/paddle-setup.ts` is scaled from US$12 (UK £9.99,
  eurozone €10.99, Australia A$17.99, Canada $16.99 CAD plus tax, and the
  regional prices). Canadian prices are shown as `$16.99 CAD`.
- **Client:** `PLANS = ['free', 'pro']`; `allows()` is "any paid plan". An
  entitlement with either server tier reads as Pro.
- **Server:** the database keeps `advanced` as the stored tier of the full
  plan, because ten functions check `plan_tier() = 'advanced'`. Migration
  `20261020120000_one_paid_plan` moves `pro` rows to it, and the webhook
  records `advanced` for every price of ours. `create-checkout` and
  `change-plan` accept `tier: 'pro' | 'advanced'` (older extensions) and sell
  the current Pro price; `prices` repeats Pro under `advanced` for them.
- **Existing subscribers** move to the US$12 price for their interval with
  `scripts/paddle-migrate-legacy.ts` (no charge now; from the next renewal;
  it found nobody to move and was removed on 7 October 2026),
  after the 30 days' emailed notice the terms promise. Until then they keep
  their price and get everything. On 2026-10-06 there were none to move.

## Consequences

- One price on every page, one plan in the extension, no "which plan has
  this?" prompts.
- `entitlements.tier = 'advanced'` means Pro. Code comments say so where it
  matters (`src/domain/plan.ts`, `supabase/functions/_shared/paddle.ts`).
- The Advanced product and the older Pro prices were archived in live Paddle
  on 2026-10-06, once nobody paid them. Archived prices keep their
  `custom_data.tier`, so the webhook still recognises any subscription left on
  one.
- Pro buyers who wanted only the on-device features pay more; Advanced
  buyers pay less.

## Alternatives considered

- **Rename the stored tier to `pro`:** cleaner, but rewrites every
  server function that checks the tier, for no change in behaviour.
- **Keep US$7 Pro as a "lite" plan:** the clutter this decision removes.
