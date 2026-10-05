# ADR-0027: Sign in before checkout on the website, and link purchases only to signed-in accounts

- **Status:** Accepted (owner, 2026-10-05)
- **Date:** 2026-10-05
- **Supersedes:** the purchase matching in [ADR-0023](0023-pricing-page-and-website-purchases.md)

## Context

ADR-0023 let rolestash.com/pricing/ open Paddle Checkout for visitors with
no account. The webhook then matched each purchase to an account by the
email typed at checkout. That email isn't verified: typing an address
doesn't prove you own it, so a purchase must not change an account its
buyer hasn't signed in to. The same goes for `custom_data`, which whoever
opens a Paddle.js checkout can set to anything.

The web board (ADR-0017) already signs people in on rolestash.com (an
emailed code, Google, or a hand-off from the extension) and can open a
checkout made by `create-checkout` for the signed-in account.

## Decision

- **Subscribe on `/pricing/` goes to the web board:**
  `/board/?checkout=<tier>-<interval>`.
  - The board moves the choice out of the address bar into this tab's
    `sessionStorage`, so it survives the Google round trip and a reload
    doesn't reopen checkout.
  - It asks the visitor to sign in (or create an account with their
    email), then shows the plan, price and account email, with
    _Continue to checkout_, _Not now_ and _Use a different account_.
  - _Continue_ calls `create-checkout`, exactly like Account in the
    extension, and opens `/pay/`.
  - `/pricing/` still uses Paddle.js for local prices, but never opens a
    checkout itself.
- **One live subscription per account.** `create-checkout` already refuses
  a second one (`already_subscribed`). The board then says _You already have
  a plan_, and offers _Manage subscription_ (Paddle's portal). Plan changes
  go through `change-plan` in the extension, which prorates.
- **`create-checkout` signs its claim.** `custom_data` carries `user_id`
  and `checkout_sig`, an HMAC-SHA256 of the user id under the service-role
  key (`checkoutSignature()` in `_shared/paddle.ts`). It is never sent to
  the browser on its own: it sits inside the server-created transaction.
- **The webhook applies an event only when:**
  1. the subscription and customer are already that account's (renewals,
     plan changes, and subscriptions linked before this ADR), or
  2. `checkout_sig` is valid for `user_id`, **and** the Paddle customer is
     already the account's or has the account's email (the customer
     `create-checkout` binds checkout to).

  Anything else is ignored with a log line, never matched by email. No
  accounts are created from purchases any more.

## Consequences

- A purchase can only change the account that started it, so a live
  subscription, a trial, or billing management can't be taken over by
  someone typing another person's email.
- Buyers need an account before paying. On the web board that's one
  emailed code, and it's the account they'll sign in to in the extension
  anyway, so there's no "sign in with your checkout email" step afterwards.
- A paid subscription the webhook ignores (for example, a checkout opened
  from a stale copy of the old pricing page) gets no plan. The log line
  names the subscription and customer; refund it in Paddle.
- Rotating the service-role key invalidates signatures on checkouts that
  haven't completed yet; subscriptions already linked keep working.
- `user_id_for_email()` is no longer called; migration
  `20261018120000_drop_user_id_for_email` drops it.
- `/welcome/` is no longer a checkout destination; checkouts land on
  `/pay/success/`.

## Alternatives considered

- **Claim on sign-in:** keep anonymous checkout, but hold each purchase
  until someone signs in with that email and accepts it. Safe, but
  needs a new table, a claim endpoint and claim UI in two places, and
  leaves money in limbo when nobody claims it.
- **Hold only conflicting purchases for manual review:** keep matching by
  email and refuse events that would replace a live subscription. Review
  found it still left trials and billing management exposed.
- **Trust the customer email for `user_id` claims:** what the webhook did
  before. A checkout opened in the browser can choose both, so it proves
  nothing.
