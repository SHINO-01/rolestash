# ADR-0023: A pricing page with local prices, and purchases matched by email

- **Status:** Accepted; purchase matching superseded by [ADR-0027](0027-sign-in-before-website-checkout.md) (2026-10-05)
- **Date:** 2026-10-02

## Context

Paddle's onboarding asks for a pricing page on our site: local prices,
monthly/yearly, and Subscribe buttons that open Paddle Checkout. Until now,
checkout only started from Account in the extension, which binds the
purchase to the signed-in user (`custom_data.user_id`). A visitor on
rolestash.com has no Rolestash session, so a website purchase would arrive
at the webhook with no account, and the plan would be lost.

rolestash.com is a static site with no server, so there's no request header
to read the visitor's country from.

## Decision

- **`/pricing/`:** a static page with `pricing.js`, using Paddle.js:
  - `PricePreview` shows Paddle's `formattedTotals` for the visitor's country,
    which Paddle detects from the IP, so we pass no country;
  - a monthly/yearly switch;
  - Subscribe opens `Checkout.open` (overlay, one-page) for exactly the price
    shown, with success going to `/welcome/`.
  - The tiers are one editable array.
  - Its CSP matches `/pay/`, and it stays `noindex` until launch.
- **One public config:** `site/assets/paddle-config.js` holds the
  environment, the client token and the price IDs. `initPaddle()` refuses an
  unknown environment, or a token that doesn't match it (`test_` vs `live_`),
  rather than defaulting. The Edge Functions now require `PADDLE_ENV` the
  same way.
- **The webhook matches website purchases to an account.** A subscription
  without `user_id` goes, in order, to:
  1. the account already billed as that Paddle customer;
  2. else the account with the checkout email (`user_id_for_email()`,
     service role only);
  3. else a new account created for that email, with no email sent.

  The subscription is then tagged with the `user_id`, so later events carry
  it. The buyer signs in to the extension with the checkout email, by code
  or Google, and the plan is there.

## Consequences

- People can buy before installing, and the plan waits for them.
- Someone could buy a plan for another person's email. They pay for it, so
  this is a gift, not an attack. The account is only usable by whoever
  controls that email.
- If the buyer signs in with a different email, support links the accounts
  by hand.
- Verified on sandbox, 2 Oct 2026: A$ prices shown from the overrides; a test
  card checkout completed and redirected to `/welcome/`; the webhook created
  the account, set it to active Pro, and tagged the subscription.

## Alternatives considered

- **Require sign-in on the pricing page:** it needs a second sign-in UI on the
  site, and most buyers don't have an account yet.
- **Ignore website purchases:** that would take money without giving the plan.
