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

| Option                                | Why not                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| Gmail/Outlook API (OAuth)             | Restricted scopes: a costly annual security assessment, and much broader access than needed |
| LLM classification (any vendor)       | Excluded by requirement; also costs money per email and sends content to a third party      |
| Storing emails for later reprocessing | Unnecessary privacy risk; the event is enough                                               |
| Fully automatic, no suggestions       | A wrong "Rejected" is worse than a one-click confirmation                                   |
