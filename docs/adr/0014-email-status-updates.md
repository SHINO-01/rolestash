# ADR-0014: Automatic status updates from job emails, with a personal forwarding address and rules (no AI vendors)

- **Status:** Accepted (design; the build is in the roadmap's Advanced phase)
- **Date:** 2026-10-01

## Context

Advanced promises that replies from employers update the board by
themselves:

- "application received";
- "we'd like to interview you";
- "unfortunately…";
- "we're pleased to offer…".

Interviews should appear on the card: a **Join** button when online, or the
time plus a map link when in person. Constraints:

- no third-party AI vendors or APIs;
- near-zero cost;
- the privacy promise holds.

Reading Gmail through Google's API needs a _restricted_ scope, which means
an annual Google security assessment (CASA) costing hundreds to thousands of
dollars. Forwarding needs no mailbox access at all.

## Decision

### 1. A personal forwarding address

- Each Advanced account gets `<random>@in.rolestash.com`. The random part
  is 16+ characters, unguessable, and can be rotated from the account
  dialog.
- The user sets up a mail filter to auto-forward job emails to it. We give
  step-by-step guides for Gmail and Outlook, with suggested filters (ATS
  sender domains, "application", "interview").
- **Gmail's forwarding confirmation:** Gmail sends a verification email to
  the new address. We detect it and show its code in the extension, so the
  whole setup stays inside Rolestash.

### 2. Receiving and parsing: a Cloudflare Email Worker

- Cloudflare Email Routing on the `in.` subdomain delivers mail to a free
  Email Worker.
- The Worker parses MIME with a bundled library, runs the rules below and
  writes the extracted **event**, not the email, to Supabase using the
  service role.
- The raw message is never stored. It exists only in the Worker's memory
  while it's processed.
- Mail to unknown or rotated addresses is dropped. Mail for accounts that
  are no longer Advanced is dropped too, and the user is told once.

### 3. Understanding intent: deterministic, scored rules

Employer emails are highly templated, and most come from a few applicant
tracking systems (Greenhouse, Lever, Workday, SmartRecruiters, Ashby,
iCIMS, SEEK and LinkedIn notifications). A rule engine in
`src/extraction/`-style pure code classifies each message into:

| Intent       | Example signals                                                                           | Board effect                        |
| ------------ | ----------------------------------------------------------------------------------------- | ----------------------------------- |
| `received`   | "we've received your application", "thank you for applying", ATS confirmation templates   | Mark Applied (if still Saved)       |
| `interview`  | a calendar invite (`text/calendar` / `.ics`), scheduling links, "invite you to interview" | Move to Interviewing; add interview |
| `assessment` | "coding challenge", "assessment", HackerRank / Codility links                             | Move to Screening                   |
| `rejected`   | "unfortunately", "not moving forward", "other candidates", "position has been filled"     | Move to Rejected                    |
| `offer`      | "pleased to offer", "offer letter", "compensation package"                                | Move to Offer                       |
| `other`      | none of the above above the threshold                                                     | No change                           |

- **Scoring:** each rule adds weighted evidence, from the subject, body,
  sender and headers. Negations and quoted history (text after "On … wrote:")
  are excluded. An intent needs both a minimum score and a margin over the
  runner-up.
- **What is changed automatically:**
  - A high-confidence result updates the card and records an activity
    entry ("Moved to Interviewing: email from Acme, 3 Oct").
  - A lower-confidence result becomes a **suggestion** on the card, with
    one-click Accept or Dismiss.
- **Every change is undoable, and the email's subject and sender are
  kept** as the reason.
- **Interviews:**
  - A calendar invite gives exact data: time, time zone, location and the
    meeting URL.
  - Without one, the rules pull meeting links (Zoom, Google Meet, Teams,
    Webex) and "Location:"/address lines, with dates parsed by the existing
    `normalize/dates.ts`.
- **Matching an email to a job** uses, in order:
  1. an ATS job/requisition ID;
  2. sender domain against the company or posting domain;
  3. job title in the subject;
  4. a company-name match.

  Anything unmatched goes to an "Unsorted updates" list for one-click
  assignment.

- **Optional on-device assist later:** Chrome's built-in model (Gemini
  Nano), which runs on the user's device and involves no vendor, may
  re-check low-confidence results inside the extension. The rules stay the
  baseline, and nothing is sent anywhere.

### 4. On the card

- **Online interview:** date and time in the user's time zone, plus a
  **Join** button that opens the meeting link.
- **In-person interview:** date and time, the location, and an **Open in
  Google Maps** link (a plain `https://www.google.com/maps/search/?api=1&query=…`
  link the user clicks; there's no Maps API and no request from the
  extension).
- **Both:** a mini calendar badge and an **Add to calendar** (`.ics`)
  download.

### 5. Accuracy: keeping updates out of "Unsorted"

A miss is one of two things. Each has its own techniques, and all of them
are deterministic and testable.

**Matching an email to a job**, in order of strength:

1. **Posting links.** Most recruiting-system emails link to the posting.
   The capture engine's `canonicalUrl` (site adapters) normalises the link,
   so it matches `job.source.url` exactly.
2. **Recruiting-system IDs.** Job and requisition IDs from per-system
   template readers.
3. **Email threads.** `Message-ID`, `In-Reply-To` and `References`: once a
   thread is matched, every later email in it follows.
4. **Per-user taught matches.** When a user assigns an unsorted update, we
   remember sender address → job for that user.
5. **Shared knowledge** (section 6): sender domain → company, and known
   email templates.
6. **Company domains learned from postings**, e.g.
   `boards.greenhouse.io/acme`, `acme.com/careers`, the apply URL domain.
7. **Fuzzy names and titles.**
   - Company names drop legal suffixes ("Pty Ltd", "Inc", "Group"), then
     token-set and Jaro-Winkler similarity.
   - Titles expand abbreviations ("Sr" → Senior, "SWE" → Software
     Engineer), then n-gram overlap.

**Guards:**

- Only jobs the user has applied to recently, in a stage where the update
  makes sense, are candidates.
- The best candidate must beat the runner-up by a clear margin. Otherwise
  the update goes to "Unsorted".

**Understanding intent**, before any keyword scoring:

1. **Structured signals decide outright:**
   - calendar invites (`text/calendar`, `METHOD:REQUEST`);
   - scheduling links (Calendly, GoodTime, recruiting-system schedulers);
   - assessment platforms (HackerRank, Codility, TestGorilla, SHL).
2. **One template reader per recruiting system** (Greenhouse, Lever, Workday,
   SmartRecruiters, Ashby, iCIMS, SEEK, LinkedIn), like site adapters.
   Templated emails are read exactly, not scored.
3. **Cleaning:**
   - HTML → text and Unicode normalisation;
   - stripping quoted history, signatures, legal footers and
     unsubscribe blocks;
   - contraction expansion and stemming (Snowball).
4. **Sentence-level scoring with context.**
   - Each sentence is scored separately, and the subject and opening lines
     weigh more.
   - **NegEx-style negation and conditional scopes** ("not…",
     "if you are unsuccessful…").
   - Hedges ("we may be in touch") are handled separately.
   - **Known traps have their own rules.** For example, "unfortunately we
     can't reply to every applicant" inside a receipt is not a rejection.
5. **Asymmetric thresholds:** `rejected` and `offer` need much stronger
   evidence than `received`, because a wrong rejection is the costliest
   mistake.
6. **Dates relative to the email's `Date` header,** with the IANA time
   zone, so "next Tuesday at 2pm AEST" becomes an exact instant.

**Measurement:**

- `tests/fixtures/emails/` holds anonymised real emails. Testers opt in to
  donate redacted examples.
- It reports precision of automatic changes, the suggestion rate and the
  unsorted rate, per intent and per recruiting system.
- CI fails if any of them get worse, like the coverage gate.
- Targets are set once the corpus exists.

**A possible later step, needing owner sign-off:** a small linear text
classifier (TF-IDF n-grams + logistic regression) trained offline on our
own labelled corpus, shipped as static weights in the Worker. It uses no
vendor or API and sends no data anywhere. It is still statistical ML,
though, which conflicts with the site's "plain rules (no AI)" wording. We
consider it only if the rules plateau, and change that wording if we adopt
it.

### 6. Shared learning: one user's correction helps every user

Corrections made by any Advanced user improve classification for everyone.
Only **general, non-personal knowledge** is shared. The fact that a given
user applied to a given company never leaves that user's own rows.

**What gets shared:**

| Knowledge                 | Key                                                                                                            | Value                                                            | Learned when                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| Sender domain → company   | sender domain (e.g. `acme-careers.io`)                                                                         | normalised company key                                           | a user assigns an update from that domain to a job at that company |
| Template → intent         | SHA-256 of the email's _skeleton_: names, dates, titles, numbers, links and addresses replaced by placeholders | intent label                                                     | a user accepts, corrects or dismisses a suggestion                 |
| Template → role of fields | skeleton hash                                                                                                  | which placeholder holds the job title, company or interview time | the same corrections                                               |

**Only hashes, domains and labels are stored centrally. Never email text,
subjects or user identifiers.**

**Promotion and poisoning resistance:**

- An entry takes effect for everyone only after **K = 3 distinct Advanced
  accounts** confirm it, with no conflicting votes above a margin.
- Votes live in `email_knowledge_votes (kind, key, value, voter)`.
  - `voter` is an HMAC of the user ID under a server-only secret, so votes
    can be counted and removed, but not linked to accounts without the
    secret.
  - Only paying Advanced accounts vote, which makes mass fake accounts
    expensive.
  - Votes are rate-limited per account.
- **Conflicting labels demote an entry to "suggest only".** An entry that
  later drops below K (for example after account deletions) is demoted
  automatically.
- **Deleting an account deletes its votes.**

**Applying it:** the Email Worker checks the shared template table before
scoring. An exact skeleton match with a promoted label decides the intent,
and promoted domain → company entries join the matching signals.

**Controls:**

- The account dialog has "Help improve automatic updates" (on by default,
  disclosed in the privacy policy). Turning it off stops that account
  voting; it still benefits from shared knowledge.
- We can review and revoke entries.

**What this can and can't guarantee:**

- Once a template or sender domain is known, **every user** gets it right
  first time. Only the first K sightings of a new template or domain across
  the whole user base can need a human.
- It can't match an update to a job that isn't on the user's board. That
  update stays in "Unsorted" with a one-click "Add this job" instead.
- A truly one-off email (a small company's hand-written reply with no
  title, link or known domain) may still need one click.
- The goal is that each distinct template or sender is classified by a
  human once, for everyone, and never again.

## Implementation notes (2026-10-01)

The engine is built in `src/email/` ([guide](../guides/email-updates.md)).
Where it differs from the plan above:

- **Not in `src/extraction/`:** it's its own pure module, with no DOM,
  because it also runs in the Email Worker.
- **Its own date parser:** dates come from `src/email/time.ts`, not
  `normalize/dates.ts`. Interviews need a time of day and a time zone, and
  posting dates need neither.
- **No stemming yet:** cleaning expands contractions and the phrase rules
  spell out word forms, which was enough for the corpus.
- **AEST/AEDT mean Sydney wall time:** people write "AEST" all year, so the
  time is read in Sydney's zone. A time without a zone is stored as
  floating, to be read in the user's zone.
- **Events are deleted once a device has them:** the device that applies
  an event deletes it from the server, so other devices don't apply it
  again. The 90-day retention only catches events no device fetched.
- **One interview per job:** a newer interview replaces the card's
  interview.
- **No service-role key in the Worker:** it holds a single-purpose ingest
  secret instead; see [ADR-0018](0018-email-worker-ingest.md).
- **Separate scheduling links:** interviews keep a scheduling link
  (`schedulingUrl`) apart from the meeting link (`meetingUrl`), so
  **Join** never opens a booking page.

## Consequences

- **Accuracy is good but not perfect.** Structured signals (calendar
  invites, ATS templates) are reliable. Free-form emails from small
  companies are where rules miss. The suggestion step keeps mistakes cheap,
  and a regression suite of anonymised real emails
  (`tests/fixtures/emails/`) grows with every miss, like site adapters.
- **Privacy:**
  - Email content passes through Cloudflare's Worker and is discarded.
  - We store the event: intent, matched job, interview time, link and
    location, subject, sender and received time.
  - The privacy policy lists this processing, and deleting the account (or
    rotating the address) stops it.
- **Cost:** Email Routing and Workers are free at our scale (100k Worker
  requests a day).
- **New moving part:** the Email Worker gets its own tests and deploy step,
  like the site Worker.
- **Security:** the address is a bearer secret. Rotation and the "stop
  forwarding" guide are in the account dialog. Rate limits per address
  stop abuse.

## Alternatives considered

| Option                                   | Why not                                                                                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Gmail/Outlook API (OAuth)                | Restricted scopes: a costly annual security assessment, and much broader access than needed                                             |
| LLM classification (any vendor)          | Excluded by requirement; also costs money per email and sends content to a third party                                                  |
| Sharing each user's taught matches as-is | They reveal who applied where. Only non-personal knowledge (domains, template hashes, labels) is shared, after K distinct confirmations |
| Storing emails for later reprocessing    | Unnecessary privacy risk; the event is enough                                                                                           |
| Fully automatic, no suggestions          | A wrong "Rejected" is worse than a one-click confirmation                                                                               |
