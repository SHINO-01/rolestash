# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] — 2026-10-02

### Added

- **Where applications end up** (Insights, Pro and Advanced): a flow chart
  from all your applications through each column they reached (Screening,
  Interviewing, your own columns such as an assessment step) to how they
  ended: an offer, rejected, withdrawn, no reply after 3 weeks, or still
  waiting. Hover or focus a flow for its share.
- **Fill your autofill profile from your résumé** (Pro and Advanced): choose
  a PDF or Word file in the profile and Rolestash fills your name, contact
  details, links, location and current role. Only empty fields are filled,
  each marked for you to check. The file is read in your browser and never
  stored or sent.
- **Profile name and photo:** add a display name and a photo in Account (the
  extension or the web board). The photo is shrunk to a small square on your
  device, shown on the board's Account button, and never loaded from Google
  or anywhere else. Without one, your initials are shown.
- **Choose "Help improve automatic updates" when you sign up:** it's ticked
  by default, and unticking it opts the new account out before anything is
  shared. You can still change it in Account.

- **Bulk actions** (Pro and Advanced): select several cards, then move them to a
  column, add a tag, archive or delete them in one go (deleting can be
  undone). Select them with **Select** in the board header, or Ctrl/⌘-click
  cards at any time; Esc clears the selection.

### Security

- **Autofill never fills fields you can't see:** transparent, zero-size,
  off-screen and style-hidden fields are skipped, so a page can't collect
  details its visible form never asks for.
- **Posting links open only as web links:** an apply link that isn't
  http(s) is dropped when a job is captured, and ignored by "Open posting"
  on the board and the web board.

### Changed

- **Plans:** Pro now includes application autofill, Insights, contacts,
  interview rounds and documents with calendar export, and bulk actions, and
  holds 60 active jobs (was 45). Advanced has no active-job limit (was 95)
  and keeps email updates, the web board and phone, 5 devices and the full
  side panel (ADR-0013 revision).
- **Wording:** the store description, the empty board and PRIVACY.md now
  describe what ships: local-first and no AI, with optional accounts, sync,
  email updates and shared learning.
- **Toolbar icon tooltip** says "open the side panel" while the icon opens
  it.
- **rolestash.com:** the plans list the side panel and bulk actions.
- **Board header:** Select, Insights and History show as icons on narrower
  screens, so the search box keeps its room.
- **Insights** (Pro and Advanced): how your search is going, from the board's new
  **Insights** button.
  - Applications per week, and how far applications get (applied →
    screening → interview → offer).
  - How often and how quickly employers reply, and which applications have
    gone 3 weeks without a reply.
  - Which job sites work best for you.
  - Worked out on your device from your own board; nothing is tracked or
    sent.
- **Side panel:** Rolestash docks on the right of the browser and stays
  open as you switch tabs.
  - **Opening it:** the button in the popup, or right-click the Rolestash
    icon → **Open side panel**. Or turn on **Toolbar icon opens the side
    panel** in the board menu, so it's always one click.
  - **On every plan:** save the page you're on and open the board.
  - **On Pro:** also autofill. **On Advanced:** Today, your board, a job's details and autofill,
    without leaving the page.
  - No new access to web pages.
- **Pin tip:** until Rolestash is pinned, the board shows how to pin it for
  one-click access.
- **Contacts, interview rounds and documents** on every job (Pro and Advanced; not
  switched on yet).
  - **Contacts:** keep the recruiter's and interviewers' details, with
    one-click email, call and LinkedIn.
  - **Interview rounds:** note each round (when, with whom, how it went).
  - **Documents:** record which résumé or cover letter you sent, by file
    name and an optional link. Rolestash never stores the files.
  - All three show on the web board too, and in the CSV export.
- **Export calendar (.ics)** (Pro and Advanced): every interview, interview round,
  follow-up and closing date on your board, as one file for Google, Apple or
  Outlook calendars. Importing it again updates the events instead of
  duplicating them, and notes and contacts are never included.
- **Application autofill** (Pro and Advanced; not switched on yet): save your
  details once in **Autofill profile…** on the board, then click **Fill this
  application** in the popup (or right-click the page).
  - **Fills** Greenhouse, Lever, Ashby, Workday and SmartRecruiters forms,
    and most company careers pages: name, contact, address, links, current
    role, work rights, salary, notice period, and your saved answers to
    common questions.
  - **Leaves alone** anything you've already typed, equal-opportunity and
    demographic questions, and file uploads, and it never submits. The
    popup lists what's left for you.
  - **Your profile stays on this device:** it isn't synced or sent anywhere.
- **Email status updates, part 4** (Advanced; not switched on yet):
  updates learn from everyone, privately.
  - When you accept or correct a suggestion ("Something else…"), or file
    an unsorted update, Rolestash shares two things: a one-way fingerprint
    of the email's template, and which company the sender's domain belongs
    to.
  - Once three accounts agree, everyone's matching emails are understood
    correctly from then on.
  - Nothing personal is shared: no email text, subjects or jobs. Turn it
    off any time with **Help improve automatic updates** in Account.
- **Email status updates, part 3** (Advanced; not switched on yet): your
  board now updates itself from the job emails you forward.
  - **Confident updates move the card for you**, with the email's subject
    and sender shown as the reason and one-click **Undo** in the timeline.
  - **Less certain ones** wait on the card as a suggestion to Accept or
    Dismiss.
  - **Emails that don't clearly match a job** go to **Unsorted updates**:
    file each one under a job (later emails from that sender follow), or
    add it as a new job.
  - **Interviews show on the card:** the time in your time zone, **Join**
    for video calls, **Open in Google Maps** for in-person ones, and **Add
    to calendar**.
  - **Setup in Account:** your forwarding address, step-by-step Gmail and
    Outlook filter guides, and Gmail's confirmation code shown right there.
    The same works on the web board.
- **Email status updates, part 2** (Advanced; not switched on yet): your
  personal forwarding address at `in.rolestash.com`, which you can replace
  at any time.
  - A receiving service reads each forwarded email in memory and keeps only
    what it found (for example "interview, Thursday 10am, Zoom link"),
    never the email itself.
  - Those results are deleted after 90 days.
- **Email status updates, part 1** (Advanced; not switched on yet): the
  rules engine that reads job emails.
  - It recognises application receipts, assessments, interviews,
    rejections and offers, and Gmail's forwarding confirmation.
  - It reads interview times from calendar invites and from text
    ("Thursday 9 October at 10am AEST", "tomorrow at 2pm"), plus Join links
    and addresses.
  - It matches each email to the right job on your board.
  - Plain rules (no AI), checked against a suite of 43 sample emails.
- **The web board signs you in by itself** when you're signed in to the
  Rolestash extension in the same browser. It gets a single-use token, never
  your extension's session. **Continue with Google** works there too,
  alongside the emailed code.
- **Web board for your phone** (Advanced) at rolestash.com/board/:
  - **Today:** follow-ups due, saved jobs closing soon, and where
    everything stands.
  - **Board and job details:** browse by column; move jobs, set
    follow-ups, edit notes, archive.
  - **Quick add:** for jobs you hear about away from your computer.
  - It syncs with your other devices and works offline. Sign in with an
    emailed code. Signing out clears the browser (ADR-0017).
- **Sync across devices** (Pro: 3 computers; Advanced: 5 devices):
  - Turn it on in _Account_, and your jobs and columns stay in step
    between browsers. Your theme stays per device.
  - The newest edit wins, deletions carry over, and everything still
    works offline.
  - The account dialog lists synced devices and removes them.
  - The server enforces the plan and the device limit (ADR-0016).
- **Capture from a pasted link** (Pro):
  - In _Add job_, paste a job link and choose _Fill in from link_.
  - Rolestash asks for access to that one site and reads the page with the
    same extractor as the toolbar button. If the page needs JavaScript, it
    uses a background tab.
  - You review the details before saving, and access to the site is
    removed afterwards.
  - The privacy policy and PRIVACY.md describe this.
- **Custom columns** (Pro): board menu → _Edit columns…_.
  - Rename, recolour, reorder, add, and archive columns.
  - Choose which column new jobs go to.
  - New columns can be in progress (optionally counting as applied) or
    finished.
  - A column with jobs on it can't be archived until they're moved.
  - On Free your columns stay as they are.
- **Follow-up reminders and closing-date alerts** (Pro):
  - Set a follow-up on any job: tomorrow, in 3 days, a week, 2 weeks, or a
    date. Rolestash notifies you when it's due, and the card shows it.
  - A daily notification lists saved jobs closing within 3 days. It can be
    turned off from the board menu.
  - Notifications are an optional permission, asked for only when you turn
    reminders on (ADR-0015).
- **History and archiving:**
  - Archive any job from its menu. It leaves the board, stops counting toward
    your plan's active jobs, and can be restored any time (subject to the
    limit).
  - _History_ lists finished (Offer, Rejected, Withdrawn) and archived jobs.
  - On Free, finished and archived jobs and timeline entries older than 30
    days are hidden, never deleted, and exports include them. Pro and
    Advanced show everything.
  - Long timelines show the latest 30 entries, with "Show all".
- **Export to CSV** from the board menu, on every plan: one row per job with
  every field, in board order. It opens cleanly in Excel, Numbers and Google
  Sheets (UTF-8 BOM), and cells that a spreadsheet would run as formulas are
  neutralised.
- Groundwork for Rolestash Pro, switched off in release builds until launch:
  - sign-in with Google or an emailed code;
  - a 30-day trial;
  - three plans: Free (15 active jobs), Pro (45) and Advanced (95), with
    rejected and withdrawn jobs not counting and local prices in the UK,
    Ireland and Australia;
  - switching between Pro and Advanced at any time, prorated;
  - Paddle checkout and the billing portal;
  - account deletion that keeps your local jobs.

### Changed

- "Notify me at launch" on rolestash.com is now a real launch list:
  - a form with double opt-in;
  - an automatic acknowledgement email once confirmed;
  - a one-click launch-day announcement (**Actions → Announce launch**).

  - occasional product news (**Actions → Send product news**, from
    `emails/news/`).

  Every email has a one-click unsubscribe (link and mail-app button) that
  deletes the address at once. It's built on Supabase and Resend, with no
  new vendors. The privacy policy has a "Launch and product news emails"
  section, and the terms a new §8, "Emails from us".

- Redesigned rolestash.com: a framed product hero with responsive, art-directed
  board screenshots, a bento feature grid, an email-updates walkthrough for
  Advanced, a plan comparison table, a JavaScript-free mobile menu, a larger
  footer and motion that respects reduced-motion. Pricing cards now have hover
  states and "Notify me at launch" buttons. `npm run site:chrome` stamps the
  shared header and footer; `npm run site:screenshots` regenerates the board
  screenshots from the E2E build.
- Links to rolestash.com now show a preview card (a 1200×630 PNG with Open
  Graph and Twitter tags); `npm run site:og` regenerates it.
- Sync is on both paid plans: Pro syncs up to 3 computers, and Advanced syncs
  up to 5 devices, including phones through the web board (ADR-0013
  revision). The site, terms, privacy policy, support page and the
  extension's plan copy say so.
- The privacy policy and support page now say that accounts are for Pro and
  Advanced, and that sync is an Advanced feature.
- Renamed to **Rolestash**, with a new logo, icons and spruce-green theme.
  Backups exported under the old name still import, and manually added jobs
  keep working.

### Fixed

- The privacy policy now says the checkout page loads Paddle.js and Paddle's
  checkout, which may use its own cookies and services. It used to say the
  site loads no third-party scripts at all.
- **SEEK** captures on the new `au.seek.com` and `nz.seek.com` domains. They
  fell back to a generic guess, which read the company as "SEEK Australia".
  Links on the old and new domains are now treated as the same job.
- **Indeed's 2026 layout:** title, company, location, pay, job type and
  description are read again.
- **Greenhouse** uses the company's real name ("GitLab", not "Gitlab").
- **Workday** drops entity codes from company names ("IL00 Mellanox…").
- Locations no longer repeat a country ("Israel, Raanana, Israel").
- **LinkedIn** dedupes by its own job id, not the employer's requisition
  number.
- Salary text no longer keeps labels like "Pay".
- Live-site snapshots (October 2026) for SEEK, LinkedIn, Indeed, Greenhouse,
  Lever and Workday now back the fixture suite
  (`scripts/snapshot-job-page.ts`).

## [0.1.0] — 2026-09-30

### Added

- Capture the current tab from the popup (review and edit before saving), the
  page context menu, or <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>J</kbd> (instant save with badge feedback).
- Layered, AI-free extraction engine: JSON-LD → microdata → site adapters →
  meta/heuristics, merged per field by confidence with provenance recorded.
- 50 site adapters (job boards, aggregators, government boards and ATS
  platforms), including canonical-URL resolution for list/search views.
- Duplicate detection by canonical URL and by site + posting id.
- Kanban board: seven default columns, drag-and-drop between and within
  columns (mouse and keyboard), search, stats, job drawer with inline editing,
  tags, auto-saving notes, description snapshot and activity timeline.
- Manual job entry; delete with undo.
- JSON backup export/import (merge or replace), versioned and validated.
- Light, dark and system themes.
- Versioned storage with forward-only migrations.
- Unit (Vitest), fixture-driven extraction and E2E (Playwright) test suites,
  with a 90% coverage gate on the core and a smoke suite for the production build.
- CI/CD: push to `dev` → quality, unit/coverage and E2E gates → fast-forward
  `main` → tag and GitHub Release on version bumps; packaged and published by
  [jobtrail-extension](https://github.com/SHINO-01/jobtrail-extension).
- `npm run release` to bump the version and roll the changelog.
