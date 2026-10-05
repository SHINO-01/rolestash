# ADR-0019: Shared learning for email updates: template fingerprints and domain votes, applied in the database

- **Status:** Accepted; hardened by [ADR-0028](0028-harden-shared-learning.md) (vote tickets, 5 voters, no big moves alone)
- **Date:** 2026-10-02

## Context

ADR-0014 §6 promises that one user's correction improves email updates for
every user, without sharing anything personal. Three facts shape how:

1. **The email text exists only in the Email Worker** (ADR-0018). The
   extension, where users accept and correct updates, never sees it.
2. **Matching runs on the device**, so the server never knows which job an
   email was about.
3. **Votes must not be linkable to accounts**, yet they must still be
   countable, removable when an account is deleted, and limited to paying
   Advanced accounts.

## Decision

- **Fingerprint in the Worker.** `emailSkeleton()` (`src/email/skeleton.ts`)
  reduces an email to its template wording:
  - mid-sentence capitalised words (names, companies, titles), numbers,
    dates, links and addresses become placeholders;
  - sentence-initial words survive only if they're common template words.

  The Worker attaches the SHA-256 of that skeleton to the event as
  `template`. The skeleton itself is never stored or sent.

- **Votes come from the device** at three moments:

  | Moment                                        | Vote                                                     |
  | --------------------------------------------- | -------------------------------------------------------- |
  | The user accepts a suggestion                 | template → its intent                                    |
  | The user corrects one ("Something else…")     | template → the chosen intent, including "not an update"  |
  | The user files an unsorted update under a job | template → intent, and sender domain → the job's company |
  - Company names are normalised (`normalizeCompany`: lower case, legal
    suffixes dropped).
  - Mail platforms and recruiting systems (gmail.com, greenhouse-mail.io,
    and so on) never get a domain vote.
  - Dismissing and undoing don't vote: they can mean "wrong job" as easily
    as "wrong meaning".

- **Storage:** votes live in `private.email_knowledge_votes (kind, key,
value, voter)`.
  - `voter` is an HMAC-SHA-256 of the user id, keyed by 32 random bytes the
    migration generates inside the database
    (`private.email_knowledge_key`). The key is never exported.
  - Each voter has one vote per key; voting again replaces it.
  - Limits: 20 votes per call, 100 a day per voter.
  - Only Advanced accounts with "Help improve automatic updates" on may
    vote. The switch is on by default, stored on the inbox, and turning it
    off withdraws that account's votes.
  - The free Advanced trial doesn't vote: it needs no card, so sign-ups
    are cheap (`20261013120000_knowledge_votes_paid_only.sql`).
  - Deleting an account deletes its votes, through a trigger on
    `auth.users`.
  - The owner revokes an entry by adding it to
    `private.email_knowledge_blocked`.
- **Promotion** happens at read time (`private.knowledge_lookup`), so it's
  always current:
  - an entry **decides** when its leading value has at least 3 distinct
    voters and at least 3 times the runner-up;
  - with 3+ voters but more contest than that, it only **suggests**;
  - an entry that falls below 3 voters (withdrawn votes, deleted accounts)
    stops applying.
- **Applied on arrival:** `ingest_email_event` looks up knowledge before
  storing the event.
  - A deciding template sets the intent and `apply` (or `none` for "not an
    update").
  - A suggesting template that disagrees turns the event into a
    suggestion.
  - A deciding domain fills `companyHint` when the email named no company,
    which matching then uses.
  - Gmail's forwarding confirmation is never overridden.

## Consequences

- **Templates are learned once for everyone:** after three Advanced users
  confirm a template, every user gets it right from then on, including
  ones the rules got wrong.
- **What the database holds:** hashes, domains, intent labels, normalised
  company names and HMACs. It can't tell who voted for what, or who
  applied where. The HMAC key is generated inside the database and never
  leaves it.
- **Poisoning takes several paying accounts** voting the same way, and
  contested entries only suggest. The owner can revoke any entry.
- **Old events have no fingerprint:** events stored before this change
  carry no `template`, so they can't teach.

## Alternatives considered

| Option                                      | Why not                                                                                |
| ------------------------------------------- | -------------------------------------------------------------------------------------- |
| Send the email text with corrections        | Breaks "we never keep the email"                                                       |
| Fingerprint on the device                   | The device never has the email; the Worker is the only place that does                 |
| Apply knowledge in the Worker               | A second round trip and more secrets in the Worker; the database already has the votes |
| Vote with the user id and hide it with RLS  | Anyone with database access could link votes to people; the HMAC prevents that         |
| Promote stored entries with a scheduled job | Stale between runs, and needs extra bookkeeping; counting at read time is cheap        |
