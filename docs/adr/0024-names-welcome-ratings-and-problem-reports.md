# ADR-0024: Keep a real name on the account, welcome new accounts once, ask for ratings sparingly, and take problem reports first-party

- **Status:** Accepted
- **Date:** 2026-10-04

## Context

The owner asked for five related things:

- the account to show the person's **real name**, with the email as the
  username;
- a **greeting by name** whenever the extension opens;
- the **name in Paddle**, because Subscription Management showed the email
  but an empty Name;
- an automatic **welcome email** for new accounts;
- an in-app way to **rate us** on the Chrome Web Store, and to **report bugs**.

Constraints (AGENTS.md):

- first-party network calls only;
- no AI;
- least data;
- the free plan works without an account.

An email address carries no name. ADR-0022's revision had removed the name
field in favour of a guess from the address ("sakifhussain33" →
"Sakifhussain").

## Decision

### Names

- **Storage:** `account_profiles.display_name` is the full name again, up to
  100 characters (legal names can be long).
- **Google sign-in:** the name Google gives
  (`user_metadata.full_name`) is saved to the profile the first time it's
  missing, so every device and Paddle see it.
- **Email-code sign-in:** Account asks once, "What's your name?", with
  _Skip_. Skipping is remembered per account on that device
  (`account:name-skipped`), and the name can always be added or changed in
  Account.
- **Account** shows _Name_ (editable) and _Email_ separately. Saving a photo
  keeps the name, and saving the name keeps the photo.
- **Greeting:** "Good morning/afternoon/evening, {first name}", from the
  first word of the name.
  - It appears under the popup header, and in the board header on wide
    screens.
  - It never animates, because people see it many times a day.
  - Accounts without a name and the free plan (no account) get no greeting;
    we don't guess.
- **Paddle:** `billing-portal` sets the Paddle customer's `name` from the
  profile just before opening Subscription Management. A failure is logged
  and never blocks the portal. Receipts then carry the name too.

### Welcome email

- **When:** after any sign-in, the client calls `welcome`.
- **Once only:** the function sends only if it can claim
  `account_profiles.welcome_sent_at`. The claim is a conditional update,
  `welcome_sent_at is null`, so two devices signing in together can't both
  send it. If Resend fails, the claim is released and the next sign-in
  retries.
- **Client side:** each device stops asking once the server has answered
  (`account:welcomed`).
- **No reset:** clients have no grant on `welcome_sent_at`, so it can't be
  reset to send the email again.
- **Content:** a service message (no unsubscribe), sent from
  `noreply@rolestash.com` with replies to support. It covers three tips and
  where to get help.

### Store rating

- **Where:** a small card in the board's corner, never a modal.
- **When:**
  - only after 10 saved jobs and 7 days since this device first opened the
    board;
  - not before 4 seconds into a visit;
  - at most 3 times, 30 days apart.
- **Ending it:** _Rate Rolestash_ opens the store's reviews page, and either
  that or _Don't ask again_ ends it for good.
- **Storage:** state lives on the device only (`prompts:rating`), with no
  network call.
- **No incentives:** we never offer anything in return for a rating, as the
  store's policy requires.

### Problem reports

- **Where:** _Report a problem_ is in the board menu and the popup header.
  It works signed out.
- **What's sent:** the dialog shows everything sent besides the message:
  - the version, the browser, the plan, and where it was sent from;
  - the page's address only if ticked.
    It never sends jobs, notes or the profile.
- **The `bug-report` function** (public, no JWT):
  - checks the message (1–5,000 characters) and the reply address;
  - attaches the account when a valid token is sent;
  - keeps only known context keys;
  - stores the report in `bug_reports`, which has no API access for users;
  - emails a plain-text copy to `support@rolestash.com`, with replies going
    to the reporter.
- **Abuse limit:** 5 reports an hour per IP address. The address is stored
  only as an HMAC (keyed with the service-role key), never in plain text.
- **Retention:**
  - reports older than 12 months are deleted whenever a new one arrives;
  - deleting an account sets `user_id` to null and keeps the report.
- **Builds without a backend** fall back to a prefilled `mailto:`.
- **Reading them (7 October 2026):** the operations dashboard's _Problem
  reports_ page lists them through `ops_admin` (`reports.list`) and moves
  them through new → seen → fixed / closed (`reports.set_status`, logged in
  `private.ops_audit`). The table still has no API access for anyone else.

## Consequences

- **More personal data:** name and problem reports. The privacy policy, the
  store's data disclosures (release repo `store/listing.md`) and Paddle all
  need to say so.
- **New functions:** two more, `welcome` and `bug-report`, deployed by hand
  like the others. They need `RESEND_API_KEY` (already a project secret for
  the launch list).
- **Ask once, really once:** the name question appears once per account per
  device. A person who skips is never nagged again, but Paddle receipts then
  have no name.
- **Tests:**
  - pgTAP covers the grants, the 100-character names and the bug-report
    lock-down;
  - unit tests cover the welcome claim and its release, the rate limit, the
    IP hashing and the Paddle name sync;
  - E2E covers the name question, the report dialog and the rating prompt.

## Alternatives considered

- **Guessing names from email addresses** (ADR-0022's revision): wrong for
  most addresses, and useless for receipts. Replaced.
- **Asking everyone for their name, Google users included:** Google already
  gives it.
- **Sending the welcome email from a database trigger** (pg_net): no retry
  path and harder to test. The client call plus a server-side claim is
  idempotent and testable.
- **A third-party feedback widget:** a third-party script and data flow.
  Rejected (ADR-0002).
- **Bug reports by email only:** this fails for people without a mail app,
  and loses the version and browser details. It stays as the fallback.
- **A rating modal on first success:** too early and too pushy, and the
  store frowns on review pressure.
