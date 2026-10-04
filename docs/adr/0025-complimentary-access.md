# ADR-0025: Grant complimentary access as data, protected from billing

- **Status:** Accepted
- **Date:** 2026-10-04

## Context

The owner needs permanent Advanced access on their own account, without a
Paddle subscription, to use and support the product. Later we may want the
same for a tester or a partner. Plans are derived everywhere from one
`entitlements` row per account (ADR-0009, ADR-0013), written only by the
service role through `apply_billing_event`, which the Paddle webhook calls.

## Decision

- **A complimentary account is an ordinary active row:** `status = 'active'`,
  the plan's `tier`, `current_period_end` far in the future
  (`9999-12-31`), plus a new `complimentary` column saying why (for example
  `owner`). Every existing check (`planOf`, `plan_tier`, `has_pro`, the RLS
  on tier-gated tables) already treats it as paid, so no client or Edge
  Function changes.
- **Billing can't touch it:** `apply_billing_event` skips rows where
  `complimentary` is set, so no webhook (a stray test purchase, a refund, a
  replayed event) can downgrade or overwrite the grant.
- **Granted by hand, never in a migration:** the grant names a person, so it
  is applied as data with the service role (SQL in the backend guide), not
  committed. Users still have no write access to `entitlements`.

## Consequences

- The account screen says "Advanced. Renews on 31 Dec 9999." until the
  extension learns to show "Complimentary" (a small client change, held
  until after the v0.4.1 store review).
- A complimentary account can't also buy a subscription: billing events for
  it are ignored. Remove the grant first if that is ever wanted.
- Deleting the account deletes the grant with it (the row cascades).
- Keep the list of complimentary accounts short and reviewed:
  `select user_id, tier, complimentary from public.entitlements where complimentary is not null;`

## Alternatives considered

- **A free Paddle subscription (100% discount):** real billing records and
  renewals for nothing, and it depends on Paddle staying configured.
- **Just editing the row, with no column:** works until the next webhook for
  that account overwrites it.
- **A client-side allow-list of emails:** client code can be changed, the
  server's RLS would still refuse Advanced features, and it ships personal
  data in the extension.
