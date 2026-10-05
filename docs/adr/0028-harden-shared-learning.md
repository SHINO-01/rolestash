# ADR-0028: Harden shared learning: vote tickets, five voters, and no big moves on shared knowledge alone

- **Status:** Accepted (owner, 2026-10-05)
- **Date:** 2026-10-05
- **Amends:** [ADR-0019](0019-email-shared-learning.md)

## Context

ADR-0019 lets paying Advanced accounts vote on what an email template
means and which company a sender domain belongs to. Three agreeing voters
decided for everyone, and a decided "rejected" or "offer" moved cards on
its own. Three weaknesses remained:

- an account could vote on any template or domain, including ones it never
  received;
- the extension skipped mail platforms' and recruiting systems' domains,
  but the server accepted them;
- three paid accounts could decide a template's meaning for everyone, so
  poisoning cost three subscriptions.

## Decision

- **Vote tickets.** When `ingest_email_event` stores an event, it adds
  `tickets: { template, domain }`. Each ticket is
  `YYYYMMDD.<HMAC>` over the receiving account's voter id, the kind, the
  key and the issue day, under the existing knowledge key. The extension
  keeps each ticket with its suggestion or unsorted update and sends it
  with the vote. `vote_email_knowledge` skips a vote without a valid ticket
  under 90 days old, and reports how many it skipped.
  - Nothing extra is stored on the server: the ticket travels with the
    event the board already fetches and then deletes.
  - Forwarding confirmations get no ticket. Neither do platform domains.
- **Platform domains on the server.** `private.is_platform_domain()`
  mirrors `isPlatformDomain()` in `src/email/ats.ts`, and a unit test
  keeps them in step. Domain votes for those are skipped.
- **Five voters.** An entry needs 5 agreeing current paid voters (still at
  least 3× the runner-up) before it decides or suggests.
- **No big moves on shared knowledge alone.** A decided template of
  `rejected` or `offer` is applied only when the email's own reading
  already applied that same move. Otherwise it arrives as a suggestion the
  user accepts or dismisses. `received`, `assessment` and `interview`
  still apply.
- Votes cast before tickets existed (none in production) are deleted.

## Consequences

- An account can only vote on mail it actually received, so poisoning
  takes five paid accounts that each receive the crafted email, and even
  then can't reject or offer anyone's job by itself.
- Extension versions from before this change send votes without tickets;
  the server skips them until people update. Nothing else breaks.
- Rotating the knowledge key would invalidate outstanding tickets and
  re-key voters; it isn't planned.

## Alternatives considered

- **Store a receipt per account and email on the server:** works, but
  keeps a per-account record of sender domains, against "results are
  deleted once your board has them".
- **Owner approval before an entry decides:** safest, but needs a review
  queue and the owner's time for every entry.
- **Raise the threshold only:** cheaper for an attacker than also
  limiting what a decided entry can do.
