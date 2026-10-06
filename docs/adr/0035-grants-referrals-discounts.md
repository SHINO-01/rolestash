# ADR-0035: Complimentary grants you can revoke, a referral programme, and discount codes

- **Status:** Proposed (owner request, 2026-10-07). Not built.
- Builds on ADR-0025 (complimentary access as data), ADR-0026 (operations
  dashboard; actions need their own decision: this is it for these three),
  ADR-0027 (sign in before website checkout) and ADR-0029 (one Pro plan;
  the database stores it as tier `advanced`).

## Context

- The owner's account has permanent Pro through ADR-0025: an `entitlements`
  row with `complimentary = 'owner'` and a far-future period end, which
  billing events never overwrite. Granting it to anyone else means hand-written
  SQL; there is no record of who granted what, no expiry and no revoke step.
- Growth wants two levers the product doesn't have yet: **referrals** (people
  who like it bring friends) and **occasional discount codes** (launch offers,
  communities, apologies).
- Constraints that shape every choice: the repos are public, so anything
  that grants paid access must run only with server secrets; the privacy promise
  rules out tracking cookies or third-party referral tools; Paddle is the
  merchant of record, so money changes (discounts, credits) go through Paddle.

## Decision

### 1. Complimentary grants: indefinite or dated, revocable, logged

- **`private.grants`**, an append-only log: `id`, `user_id` (or a pending
  canonical-email HMAC for someone who hasn't signed up yet), `reason`
  (`owner`, `team`, `tester`, `partner`, `support`, `referral`), `expires_at`
  (null = indefinite), `note`, `granted_at`, `granted_by`, `revoked_at`,
  `revoked_by`. Not readable by clients.
- **The entitlement stays the single source of truth.** Granting sets the
  ADR-0025 shape (`status = 'active'`, `tier = 'advanced'`,
  `complimentary = <reason>`, `current_period_end = expires_at` or
  `9999-12-31`). Billing keeps ignoring complimentary rows.
- **Revoking** clears `complimentary` and recomputes the plan from Paddle: if
  the account has a live subscription it returns to it; otherwise it drops to
  Free. Data is never touched (lapsed accounts keep viewing, editing,
  exporting; AGENTS.md rule 2). Dated grants expire the same way, by a daily
  job.
- **Pending grants by email:** a grant for an email with no account yet is
  stored against its canonical-email HMAC (the trial-claims helper) and applied
  at first sign-in, so the owner never has to wait for someone to sign up.
- **Two ways to run it**, both server-only:
  1. `scripts/grants.ts` (service role from `secrets.env`, like the Paddle
     scripts): `grant <email> --reason team [--until 2027-01-31] --note …`,
     `revoke <email> --note …`, `list`. Dry run by default, `--apply` to act.
     Built first: it covers the owner's needs today.
  2. An operations dashboard action (behind Cloudflare Access, with a typed
     confirmation), added later on the same SQL functions.
- **Client:** the account dialog already says "Complimentary"; it also shows
  the end date of a dated grant. A revoke reaches the extension at its next
  entitlement check (the cached `checkedAt` window), and the web board at once.
- The owner's existing grant is copied into the log, so the list is complete.

### 2. Referral programme: "give 50%, get a month"

- **Codes:** every signed-in account (Free, trial or Pro) gets one referral
  code: 8 characters of unambiguous base32, random, not derived from the email,
  and rotatable. The link is `rolestash.com/r/<code>`; the extension's Account
  shows it with Copy and Share, plus "N friends joined · M free months earned".
- **Friend's reward: 50% off their first month** of Pro monthly (a Paddle
  percentage discount restricted to the monthly price, one billing interval).
  Quarterly and yearly are already discounted, so the referral applies to
  monthly only; the pricing page says so.
- **Referrer's reward: one free month of Pro** per friend who **pays and stays
  past the 14-day refund window** (no refund, no chargeback):
  - a paying referrer's next renewal moves out by one month through Paddle's
    subscription API (no charge, no proration);
  - a Free or trial referrer gets a dated complimentary grant (part 1,
    reason `referral`, 30 days, stacking end dates).
  - **Cap:** 12 reward months per referrer per year.
- **Attribution without tracking:** `/r/<code>` redirects to
  `/pricing/?ref=<code>`; the page keeps it in `sessionStorage` for the visit
  only, and checkout sends it to `create-checkout`, which validates it
  server-side and puts it on the Paddle transaction's `custom_data`. No
  cookies, no fingerprinting, nothing set by a third party. A code can also be
  typed in at checkout or in the extension's upgrade step.
- **Anti-abuse:**
  - no self-referral: the friend's canonical-email HMAC and Paddle customer
    must differ from the referrer's;
  - one referral reward per friend, ever (canonical-email HMAC, so
    `name+1@gmail.com` and dots don't create new friends), and only for
    accounts that have never paid before;
  - rewards wait 14 days and are voided by a refund or chargeback (the webhook
    already sees adjustments);
  - code lookups are rate-limited per IP (hashed, like problem reports) so codes
    can't be enumerated;
  - every step is a row in `private.referrals` (`referrer_id`, `code`,
    `friend_id`, `friend_email_hmac`, `transaction_id`, `status`: pending,
    qualified, rewarded, void, with timestamps), visible to the owner on the
    operations dashboard.
- **Qualifying** runs daily (the same scheduled job that expires dated
  grants): pending referrals older than 14 days without a refund become
  qualified, then rewarded.
- **Terms and privacy:** a referral section in the terms (rewards, cap, abuse
  voids rewards, the programme can end with notice) and a privacy line (we
  record which account referred which, to pay the reward; the friend's email
  isn't shown to the referrer, only a count).

### 3. Discount codes: Paddle-native, occasional, scripted

- **Codes are Paddle discounts:** percentage, restricted to the three Pro
  prices, with a usage limit and an expiry, created by
  `scripts/paddle-discounts.ts` (`create LAUNCH30 --percent 30 --until … --limit 200`,
  `list`, `archive`; dry run by default, `--apply` to act). The operations
  dashboard already lists active discounts.
- **Promo links:** `/pricing/?code=LAUNCH30` carries the code into checkout;
  `create-checkout` checks it with Paddle (active, applies to the chosen price)
  and attaches it, so the visitor sees the discounted price before paying.
  Paddle's own "Add discount" field in checkout stays on for typed codes.
- **One discount per payment** (Paddle's rule): if a visitor has both a
  referral and a code, checkout applies whichever saves more and says so.
- **Codes never grant access by themselves:** a 100% code would be a free
  subscription in Paddle; complimentary access goes through part 1 instead.

## Build order and estimates

1. Grants: migration (`private.grants`, functions, pending-by-email,
   daily expiry), `scripts/grants.ts`, account dialog end date, pgTAP tests.
   About half a day.
2. Discount codes: `scripts/paddle-discounts.ts`, `?code=` on the pricing page
   and in `create-checkout`, tests. About 2 hours.
3. Referrals: migration (`private.referrals`, codes), `/r/<code>`, checkout
   attribution, webhook and daily qualifying job, the referrer reward
   (Paddle next-billed-at move or dated grant), the Account panel, terms and
   privacy, ops dashboard panel, tests. About 1–2 days.

Live Paddle changes (creating the referral discount, any campaign code) are
owner-approved steps, like every live Paddle change.

## Consequences

- The owner can grant and revoke Pro for anyone in one command, with a record
  of why, and dated grants end on their own.
- Growth gets two levers, both priced so the business still earns on every
  referred customer after month one.
- More moving parts on the server: two private tables, a daily job and a
  Paddle subscription update path, all covered by pgTAP and unit tests.

## Alternatives considered

- **A third-party referral platform:** fast, but adds a tracking vendor and
  cookies, against the privacy promise and AGENTS.md rule 1.
- **Free months as Paddle credits for everyone:** Free referrers have no
  subscription to credit; dated grants cover them.
- **Rewarding at signup instead of after payment:** easy to farm with
  throwaway accounts.
- **100% discount codes for comps:** puts free subscriptions in Paddle's
  records and renewals; ADR-0025 already rejected this.
