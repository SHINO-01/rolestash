# Email status updates: the engine

Advanced users forward job emails to a personal address, and the board
updates itself (ADR-0014). This guide covers the **engine** in `src/email/`:
how one email becomes an `EmailEvent`, how an event is matched to a job, and
how to fix a miss. The server side (the Email Worker) and the extension UI
come in later milestones.

## Rules, not AI

Everything is deterministic and runs locally in our own code. There are no AI
vendors and no network calls. The site promises "plain rules (no AI)".

## Purity

`src/email/` is in ESLint's "pure" block, with `src/domain` and
`src/extraction`: no `chrome`, React or storage imports. It also uses **no
DOM**, because it runs in a Cloudflare Email Worker:

- `html.ts` is a small tag tokenizer;
- `htmlToText` in `src/extraction/normalize/text.ts` uses `DOMParser`, so
  don't import it here.

## From email to event: `analyzeEmail(input)`

The Worker passes in an `EmailInput`: `from`, `subject`, `date` (ISO), the
thread headers, `text`, `html` and any `calendar` (raw ICS). The steps run in
this order:

1. **Cleaning** (`clean.ts`, `html.ts`):
   - HTML → text, keeping link targets;
   - a manual forward ("---------- Forwarded message") is unwrapped, and the
     inner sender and subject are used;
   - quoted history is dropped: "On … wrote:", `>` lines, "Original
     Message", Outlook "From:/Sent:" blocks, and the HTML `gmail_quote` and
     `divRplyFwdMsg` blocks;
   - signatures (`-- `) and footer lines (unsubscribe, privacy, "do not
     reply", confidentiality notices) are dropped.
2. **Gmail's forwarding confirmation** (sender
   `forwarding-noreply@google.com`) → `forwarding_verification`, with the
   code and the `https://mail-settings.google.com` link. Links on other
   hosts are never trusted.
3. **Structured signals** (`ics.ts`, `links.ts`) decide outright:
   - a calendar invite (`METHOD:REQUEST`/`PUBLISH`, timed VEVENT) →
     interview. TZIDs resolve through `Intl`, including Outlook's Windows
     zone names. `METHOD:CANCEL` → no change;
   - a scheduling link (Calendly, GoodTime, cal.com, recruiting-system
     schedulers) → interview, unless the text is a clear rejection;
   - an assessment link (HackerRank, Codility, TestGorilla, SHL,
     CodeSignal, …) → assessment, with the same exception;
   - a meeting link (Zoom, Meet, Teams, Webex) adds interview evidence and
     becomes the **Join** link.
4. **Template readers** (`ats.ts`), picked by sender domain or posting link:
   Greenhouse, Lever, Workday, SmartRecruiters, Ashby, iCIMS, SEEK and
   LinkedIn.
   - System notifications decide the intent. Examples: LinkedIn "your
     application was sent" → received; "was viewed" and job alerts →
     other.
   - Receipt templates add evidence.
   - Readers also give the company, title and job id hints.
5. **Sentence scoring** (`intent.ts`):
   - Phrase rules add weight per intent. The subject counts ×2 (×0.5 for a
     "Re:" reply) and the first three sentences ×1.5. Each rule counts once.
   - **Negation** (NegEx-style, six words back, broken by "but/however")
     cancels positive intents.
   - **Conditions** ("if you are unsuccessful…", "should you be
     shortlisted…") cancel progress intents. Courtesy conditions ("if you
     have any questions") are removed first, so they don't cancel a real
     rejection.
   - **Hedges** ("may", "in future", "be in touch") cut progress intents
     to about a third.
   - **Traps** are removed before scoring:
     - "unfortunately we can't reply to every applicant" (counts as receipt
       evidence instead);
     - "this is not an offer of employment";
     - "we offer flexible working";
     - "pleased to offer you **an interview**", which is an interview.
   - When any progress intent reaches its suggestion threshold, receipt
     evidence is scaled down, since rejections also say "thank you for
     applying".
6. **Thresholds** are asymmetric, because a wrong "Rejected" is the costliest
   mistake:

   | Intent     | Suggest | Apply |
   | ---------- | ------- | ----- |
   | received   | 2       | 3     |
   | assessment | 2.5     | 4.5   |
   | interview  | 2.5     | 4.5   |
   | rejected   | 3       | 6     |
   | offer      | 3       | 7     |

   An apply also needs a margin of 2.5 over the runner-up, and a suggestion
   a margin of 1. Anything below that is `other` with action `none`.

7. **Interview details:**
   - from the invite: exact start and end, zone, location and meeting link;
   - otherwise from the text (`time.ts`): "Thursday 9 October at 10am AEST",
     "Oct 10, 2:30 PM PT", "tomorrow at 2pm" or "next Tuesday at 11am",
     relative to the email's `Date`.
   - A time without a zone is **floating** (`floating: true`, no offset), to
     be read in the user's time zone.
   - Australian abbreviations (AEST/AEDT/AET) are read as Sydney wall time,
     because people write "AEST" all year.

## Matching an event to a job: `matchEvent(event, intent, jobs, stages, memory)`

Matching runs in the extension, where the jobs are. Signals, strongest first:

| Signal                                                                 | Points  |
| ---------------------------------------------------------------------- | ------- |
| Thread: `In-Reply-To`/`References` seen before (`memory`)              | decides |
| Posting link, canonicalised as capture does (site adapters)            | 10      |
| Sender taught by an earlier assignment (`memory.senders`)              | 8       |
| Job id = `job.externalId` (same recruiting system; 5 if not)           | 8       |
| Company name (legal suffixes dropped) or in the subject                | 4 / 3   |
| Sender domain = the company's own posting domain, or contains its name | 4       |
| Title (abbreviations expanded: Sr → Senior, SWE → Software Engineer)   | 3 / 1.5 |

**Guards:**

- Only active, unarchived jobs from the last year are candidates.
- Only "received" may match a job that isn't applied yet (Saved).
- The best candidate needs at least 4 points **and** a 3-point lead.
  Otherwise the result is `ambiguous` or `none`, which goes to "Unsorted".

`targetStage(intent, job, stages)` picks the column. It never moves a card
backwards, and it works with custom columns by kind and name.

## Fixing a miss

1. Add `tests/fixtures/emails/<case>.json`, containing `description`, `input`
   (an `EmailInput`) and `expected` (`intent`, `action`, and optionally
   `interview`, `verification`, `ats`, `atsJobId`, `companyHint`,
   `titleHint`).
   - **Fictional companies only**, on `.example` domains.
   - Recruiting-system sender domains stay real, because detection needs
     them.
2. Run `npx vitest run tests/unit/email`. The corpus test prints a table per
   intent, and the failure message lists the rules that fired.
3. Fix the rule, threshold or trap. The corpus test requires:
   - **100% precision for `apply`**: an automatic change is never the
     wrong intent;
   - every fixture's expected intent and action.

Prefer a narrow trap or a template reader over loosening a threshold.
