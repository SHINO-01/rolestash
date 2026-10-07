# ADR-0038: Customer emails and targeted discounts from the operations dashboard

- **Status:** Accepted (owner request, 2026-10-07)
- **Date:** 2026-10-07
- Builds on ADR-0024 (account emails), ADR-0035 (grants, referrals, codes)
  and ADR-0037 (dashboard actions).

## Context

The owner wants customers to get a well-designed email when they're given
complimentary Pro, when a new discount code is created, and when the referral
programme is turned on, plus a way to send discounts to chosen people, all
from operations.rolestash.com.

Offers are commercial messages: under the Spam Act 2003 (Cth) they need
consent (customers' consent is inferred from the account), our identity, and
a working unsubscribe. A complimentary Pro email is a service message about
the person's account.

## Decision

1. **Who sends:** the ops Worker, through Resend's batch endpoint (100 per
   call, at most 1,000 recipients per send, an idempotency key per send),
   with `RESEND_SEND_KEY`, a Resend key that can only send. The panels' read
   key stays separate.
2. **Complimentary Pro:** Grants → Give Pro has "Email them" (on by default).
   The email says what they got and until when, and how to start (add the
   extension, or open the web board). No opt-out link: it's a one-off service
   message.
3. **Offers go only to account holders**, chosen in the database
   (`private.audience`), never from a list the Worker keeps:
   - segments: everyone, Free (not on Pro now), trial ended and never paid,
     paid before but not now, on Pro now, or only the emails listed (people
     without an account are skipped);
   - never anyone who opted out, and **at most one offer a week** per person
     (`private.marketing_contacts.last_offer_at`, set when recipients are
     claimed, so a retry can't double-send);
   - every offer has a one-click opt-out link and `List-Unsubscribe`
     headers (RFC 8058). The link is `launch-list?optout=<token>`, handled by
     the existing launch-list Edge Function, which shows
     rolestash.com/notify/no-offers/.
4. **When offers are sent:** optionally when a code is created (Discount
   codes, "Email it to", default nobody), when referrals are turned on
   (default everyone), and from the new **Emails** page: email a live code,
   announce referrals, or send a **targeted discount**.
5. **Targeted discounts:** one new Paddle code per send (`FOR` + 6
   characters), limited to as many uses as people emailed, valid for 1–90
   days (default 14). A shared code with a usage limit keeps the Worker
   within its subrequest limit; per-person codes would need one Paddle call
   each.
6. **Previews and logs as before:** every send is two steps; the preview
   says how many people, which segment, and three masked examples. Each send
   and its recipient count are logged in `private.ops_audit`
   (`email.grant`, `email.code`, `email.targeted`, `email.referrals`,
   `email.recipients`), not the addresses.
7. **Design:** one branded layout (inline styles only), a highlighted box
   for the code or plan, one button, plain-text alternative.

## Consequences

- New owner steps: apply the migration, redeploy `launch-list`, set
  `RESEND_SEND_KEY` on the Worker.
- Opt-outs are per account and cascade on account deletion. The updates
  list (launch-list) keeps its own unsubscribe.
- A send that fails after recipients were claimed leaves them marked for a
  week; the notice says so, and the log shows the failure.

## Alternatives considered

- **Resend Audiences and Broadcasts:** Resend would manage unsubscribes, but
  every account would have to be copied into Resend and kept in step.
- **Per-person single-use codes:** stronger targeting, but one Paddle call
  per person; can come later as a queued job.
- **Emailing the updates list too:** different consent and unsubscribe;
  product news stays on Actions → Send product news.
