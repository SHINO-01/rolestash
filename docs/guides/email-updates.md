# Email status updates: the engine

Advanced users forward job emails to a personal address, and the board
updates itself (ADR-0014). This guide covers the **engine** in `src/email/`:
how one email becomes an `EmailEvent`, how an event is matched to a job, and
how to fix a miss. It also covers the server side (the
database and the Email Worker) and what the extension and web board do with
events.

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

## Receiving mail: the Email Worker

`infra/email-worker/` (ADR-0018) is a Cloudflare Email Worker for
`*@in.rolestash.com`. For each message, it:

1. reads the token from the envelope recipient: 20 characters, `+tags`
   ignored, nothing else accepted;
2. drops mail larger than 3 MiB unread;
3. parses the MIME in memory with the bundled `postal-mime`, including any
   `.ics` part;
4. runs `analyzeEmail`;
5. calls `ingest_email_event` with its ingest secret, and retries once on a
   network error or 5xx.

The database decides the rest: unknown or rotated address, account not on
Advanced, rate limit (30 an hour, 200 a day per address), duplicate
Message-ID. Mail is never bounced, and only the outcome is logged.

Tests: `tests/unit/email-worker/` uses real MIME and a fake `fetch`. A
bundle test keeps zod and the DOM out of the engine. Check the bundle with:

```bash
npx wrangler@4.144.0 deploy --config infra/email-worker/wrangler.jsonc --dry-run
```

It should be about 180 KiB.

## One-time setup

1. **Database:** push the migration. Then check the security advisor.
2. **Deploy:** CI deploys `rolestash-email` after "Promote to main".
3. **Ingest secret:** create it once, then rotate it the same way. The
   plaintext goes only into the Worker; the database gets its SHA-256.

   ```bash
   set -a; . ./secrets.env; set +a
   secret="$(openssl rand -base64 32)"
   printf '%s' "$secret" | npx wrangler@4.144.0 secret put EMAIL_INGEST_SECRET --name rolestash-email
   printf '%s' "$secret" | sha256sum | cut -d' ' -f1   # → <hex>
   unset secret
   ```

   Then store the hash (SQL editor or the Supabase MCP):

   ```sql
   insert into private.email_ingest_secret (sha256) values (decode('<hex>', 'hex'))
     on conflict (id) do update set sha256 = excluded.sha256;
   ```

4. **Email Routing (owner, Cloudflare dashboard):**
   - zone `rolestash.com` → **Email → Email Routing**. Enable it for the
     **subdomain** `in.rolestash.com` and add the MX and TXT records it
     proposes;
   - **Routing rules → Catch-all address** → action **Send to a Worker**
     → `rolestash-email` → enabled.
5. **Check:** forward a test email to your own address (from `my_inbox()`).
   A row appears in `email_events`, and the Worker's logs show
   `email: stored`.

## On the board: `EmailUpdateService`

`src/services/email-update-service.ts` runs on any client with the account:
the extension's 15-minute background tick (just before sync), and an open
board or web board on open, on focus and every 5 minutes. A storage lease
stops two contexts running at once. Each run:

1. **Pulls events** after its cursor (`email_events`, owner RLS) and
   validates them with `EmailEventSchema`.
2. **Matches locally** (`matchEvent`), with this device's memory:
   - Message-ID → job, so replies in a thread follow;
   - sender → job, taught when the user files an unsorted update.
3. **Acts:**

   | Result                          | What happens                                                                                                                                                      |
   | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Matched, `apply`                | `JobService.applyEmailUpdate`: move (via `targetStage`, never backwards) and/or set `interview`, as one `email_update` timeline entry with the subject and sender |
   | Matched, `suggest`              | `job.suggestion`, with Accept / Dismiss on the card                                                                                                               |
   | Not matched (none or ambiguous) | "Unsorted updates": file under a job, **Add this job**, or dismiss                                                                                                |
   | Gmail confirmation              | The code is shown in Account for 7 days                                                                                                                           |

4. **Deletes** the processed events from the server, so another device
   doesn't apply them twice.

Undo: every `email_update` entry in the timeline has **Undo**
(`JobService.undoEmailUpdate`). It moves the job back, if it's still where
the update put it, and removes the interview the update set. The entry
stays, marked undone.

### The UI (`src/features/email/`)

- **Account:** the address with Copy, Gmail and Outlook filter guides, the
  Gmail confirmation code, **Check now** and **Get a new address**. The
  extension and the web board share this.
- **Card:** an interview badge (`InterviewChip`), and a "Rejection?"-style
  badge while a suggestion waits.
- **Details:** the suggestion banner, and the interview panel:
  - **Join** (meeting link) or **Pick a time** (booking link);
  - **Open in Google Maps**, a plain search link for physical locations;
  - **Add to calendar**, a `.ics` built locally by `domain/interview.ts`.
    Exact times are written in UTC, and floating times stay floating.
- Only `http(s)` links are ever rendered (`safeHref`). Nothing is fetched.

## Shared learning (ADR-0019)

One user's confirmation teaches every user, with nothing personal shared:

- **Fingerprints:** the Worker adds `template`, the SHA-256 of
  `emailSkeleton()` (`src/email/skeleton.ts`). That's the email's wording
  with names, companies, titles, numbers, dates, links and addresses
  replaced by placeholders, and it needs at least 8 template words. The
  skeleton itself never leaves the Worker.
- **Votes** go to `vote_email_knowledge` from `EmailUpdateService`:

  | When                                                    | Vote                                                            |
  | ------------------------------------------------------- | --------------------------------------------------------------- |
  | Accept a suggestion                                     | template → intent                                               |
  | "Something else…" on a suggestion                       | template → the chosen intent (or `other`)                       |
  | File an unsorted update ("File here" or "Add this job") | template → intent, and domain → `normalizeCompany(job.company)` |

  Mail platforms and recruiting systems never get domain votes. Votes are
  best effort: a failure never blocks the user.

- **Promotion:** an entry decides at 3+ distinct voters with at least 3× the
  runner-up, and only suggests when contested. `ingest_email_event` applies
  it as mail arrives.
- **The switch:** "Help improve automatic updates" in Account, on by
  default (`set_email_sharing`). Turning it off withdraws that account's
  votes.

### Reviewing and revoking (owner, SQL editor)

```sql
-- What's promoted or close to it:
select kind, key, value, count(*) as voters
from private.email_knowledge_votes group by 1, 2, 3 having count(*) >= 2 order by 4 desc;

-- Revoke an entry (it stops applying immediately):
insert into private.email_knowledge_blocked (kind, key) values ('domain', 'example.com');
```

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
