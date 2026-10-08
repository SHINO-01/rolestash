# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.6.6] — 2026-10-09

### Fixed

- **The guided tour stays put when a job's details open or close:** it no
  longer blinks or jumps while the panel slides.

## [0.6.5] — 2026-10-09

### Fixed

- **Someone else signing in on the same browser starts clean.** Sync, a
  connected inbox and email updates belonged to the last person, so they're
  reset, and jobs left on the board aren't synced into the new account: a
  notice asks whether to keep them or remove them from this browser.
- **Signing out disconnects a connected inbox,** so mail access ends with you.
- **Smoother guided tour:** the spotlight and the card glide between steps
  and follow what they point at without lagging or flickering.

### Changed

- **Gmail for Google's review goes by a tester grant on the server,** so no
  account is named in the extension.

## [0.6.4] — 2026-10-09

### Changed

- **Gmail stays paused for everyone except Google's reviewers,** who can
  connect it to check Rolestash before approving it. Mailboxes connected
  earlier keep working.

### Fixed

- **A connected inbox reads new job emails straight away,** however much
  older job-board mail it holds. It used to work through the last two weeks
  oldest first, so on a busy inbox a new email could wait many checks.
  LinkedIn, SEEK and Indeed alerts no longer count as job emails; their
  application emails still do.
- **Updates arrive within about a minute** while your board is open with
  Gmail or Outlook connected (even on another tab), and as soon as you come
  back to the board. It used to wait up to five minutes unless you clicked
  Check now.
- **A notification when an email updates a card** while you're on another
  tab or app (turn it on under your connected mailbox). Click it to open the
  card.
- **Check now says what happened:** it no longer says "Your board is up to
  date" when the check was skipped or couldn't reach the inbox.

## [0.6.3] — 2026-10-09

### Changed

- **Connecting Gmail is paused** until Google finishes reviewing Rolestash's
  read-only Gmail access, so nobody sees Google's "unverified app" warning.
  Forwarding your job emails still updates your board.
- Everything listed under 0.6.2 below, which wasn't published on its own.

## [0.6.2] — 2026-10-09

### Added

- **A guided tour:** the first time you open Rolestash, a short tour shows
  every part of the board: saving jobs from job sites, the lanes, a card's
  details, adding jobs yourself, search, Insights, History, selecting several
  jobs, the menu, autofill and accounts. You try dragging and opening a
  practice card, which is removed when the tour ends. Skip or close it at any
  step (Esc works too). It works with a keyboard and a screen reader.
- **Already using Rolestash?** Your board isn't interrupted: a small card in
  the corner offers the tour, and your own jobs are never changed by it.
- **Help (?) → How do I…?:** forgot how something works? Pick a feature (moving
  a job, editing columns, autofill, exports…) and Rolestash shows you, step by
  step, on your own board. The full tour, keyboard shortcuts, the help pages
  and Report a problem are in Help too.
- **A quick guide in the widget:** the first time the Save job panel shows a
  job, three short tips explain what it found, the lanes and saving.
- **The board opens after you install Rolestash,** so the tour can start.

### Changed

- **Pages that aren't job postings say so:** the Save job panel no longer
  opens a job form titled after a news article or a search page. It says the
  page doesn't look like a job posting and points you to job sites and your
  board. You can still save the page if it is a job.
- **A clearer empty board:** three steps to your first saved job, with
  buttons for the tour and for adding a job yourself.
- **The board menu is grouped** into Board, Export and backup, Save job button
  and Theme. Keyboard shortcuts and Report a problem moved to Help.
- **Easier to read:** small grey text (dates, counts, hints) has more
  contrast, in light and dark mode.
- **The widget's board button now says "Board".**

## [0.6.1] — 2026-10-07

### Changed

- **Rejected is a lane again:** the board has five lanes, Saved, Applied,
  Interviewing, Offer and Rejected, so turned-down applications stay in view.
  Rejected jobs still don't count toward the Free plan's 30 active jobs, and
  new jobs still start in one of the first four.

## [0.6.0] — 2026-10-07

### Added

- **Invite friends:** Account shows your referral link when the referral
  programme is running. Friends get money off their first month of Pro, and
  you get a free month for each one who stays past 14 days.
- **Discount codes:** add a code on the pricing page, or follow a promo link,
  and it's applied at checkout.
- **Optional password:** Account → Security lets you add a password and sign
  in with it, instead of waiting for a code. It must be at least 12
  characters and not easy to guess (checked on your device). Codes and
  Google keep working. "Forgot password?" emails a link to choose a new one,
  which signs out every device.
- **Two-step sign-in:** turn it on in Account → Security with any
  authenticator app (Google or Microsoft Authenticator, 1Password, Authy).
  Every sign-in then also asks for the app's code, so someone who gets into
  your email still can't get in. Add a backup app in case you lose your
  phone.
- **Sign out everywhere:** Account → Security ends your sessions on every
  device at once.
- **Your board on your phone:** Account → Sync shows a QR code for the web
  board. Scan it, sign in with the same email, and add it to your home
  screen.
- **Report a problem on the web board:** Account on the web board now has
  _Report a problem_, so you can tell us about an issue from your phone too.

### Changed

- **Complimentary Pro with an end date** now shows that date in Account.

## [0.5.0] — 2026-10-07

### Changed

- **Four lanes on the board:** Saved, Applied, Interviewing and Offer.
  Rejected no longer takes a lane: set it from a job's column menu (or
  "Move to" for several jobs), and find rejected jobs in History. Jobs in
  Screening move to Interviewing, and jobs in Withdrawn move to Rejected
  with a note in their history that you withdrew.
- **Email updates about a test or a screening call** are noted on the card
  and leave it in its column.

## [0.4.7] — 2026-10-06

### Changed

- **The Rolestash button is on job sites by default,** and on every site
  only if you turn on "Show the button on all sites" (board or widget
  menu). Chrome asks for less when you install or update, and the toolbar
  icon still opens Rolestash on any page.

## [0.4.6] — 2026-10-06

### Added

- **Connect Gmail or Outlook (Pro):** status updates now come straight from
  your inbox, with no forwarding filter to set up. Rolestash reads only job
  emails, read-only, in the extension on your computer; nothing from your
  inbox reaches our servers. Your board catches up as soon as Chrome opens
  and every few minutes after, and Disconnect removes the access.

## [0.4.5] — 2026-10-06

### Changed

- **The Rolestash button is on every page,** not only on job sites, so
  company careers pages and every applicant tracking system get it too. It
  shows just the logo until a job posting is open, then says "Save job".
  Chrome asks once to allow Rolestash on all sites; the button reads
  nothing from a page until you open the panel.
- **Put the button where you like:** drag it to any height on the left or
  right edge (it snaps into place and remembers), or move it with the
  arrow keys. The panel opens on the same side.

## [0.4.4] — 2026-10-06

### Changed

- **One paid plan:** Pro and Advanced are now one plan, Pro, with
  everything: unlimited active jobs, status updates from your job emails,
  full autofill, Insights, contacts and documents, reminders, and sync
  across 5 devices including your phone. It's US$12 a month, US$30 every 3
  months or US$99 a year, in your currency, with the 14-day free trial.
- **Canadian prices read as "$16.99 CAD".**
- **Rolestash now floats on job sites:** on SEEK, LinkedIn, Indeed, Workday
  and the other supported sites, a small Rolestash button sits at the edge
  of the page. It opens a compact panel to save the job, fill the
  application and mark it applied, without leaving the page. The toolbar
  icon opens the same panel on any other site. You can hide the button on
  a site from its menu.
- **Chrome asks once to allow Rolestash on job sites,** so the button can
  appear there. It reads a page only when you open the panel.
- **Less to read, fewer things to click:** Add job has one link box instead
  of two; Account asks for your name once, drops lines that didn't apply
  to your plan and shortens its notes; an empty board no longer shows
  Insights and History, and says where the new button is.

### Removed

- **The side panel and the popup:** the floating panel replaces both.

### Fixed

- **Location, salary and workplace come through more often:** when a page
  only states them in the job description ("Location: Sydney", "Salary
  range: $120,000 – $140,000", "this is a hybrid role"), Rolestash now
  reads them from there and marks them for you to check.
- **The board's greeting is never cut short:** it now has a row of its own
  above the board, next to a short summary of your search, and the header
  keeps only the buttons.

## [0.4.3] — 2026-10-05

### Security

- **Trial records are better protected:** the record that stops an email
  getting a second free trial is now a keyed hash, and one mailbox gets one
  trial whichever way its address is written.
- **Shared email learning only counts current subscribers:** votes from an
  account stop counting when its Advanced subscription ends, and count
  again if it resubscribes.
- **Email updates do less work for mail nobody should receive:** a
  forwarded email is only read once its Rolestash address is confirmed
  active, and more of the email rules keep a steady speed however an email
  is written.
- **Buying on rolestash.com now starts with signing in:** Subscribe on the
  pricing page asks you to sign in (or create an account) first, and a
  purchase only ever applies to the account that made it.
- **Turning off "Help improve automatic updates" always counts:** your
  choice is now honoured even before you've set up email updates.
- **A full refund ends the plan straight away,** as the refund policy says,
  instead of at the end of the period that was refunded.
- **Nothing is shared during the free trial:** "Help improve automatic
  updates" now only appears once you subscribe, and a trial sends nothing.
- **Shared learning is harder to game:** an account can only teach Rolestash
  about emails it actually received, it now takes five subscribers to agree,
  and shared learning alone never marks a job rejected or as an offer; it
  suggests instead.

## [0.4.2] — 2026-10-05

### Changed

- **New pages on rolestash.com:** every supported job site by region, a page
  for Australia, how Rolestash keeps your search private, and a guide to
  tracking job applications with a free spreadsheet template, and
  side-by-side comparisons with Teal and Huntr.

### Security

- **Shared email learning only counts paying accounts:** accounts on the free
  trial no longer vote on how other people's forwarded emails are read.
- **Safer billing:** a subscription is only linked to your account when its
  billing customer is already yours or carries your email.
- **Email updates stay fast** however a forwarded email is built.

## [0.4.1] — 2026-10-04

### Added

- **Your name on your account:** signing in with Google fills it in; with an
  email code, Account asks once (you can skip). Account shows your name and
  email separately, and the name appears on your receipts and in
  subscription management.
- **A greeting by name** when you open Rolestash ("Good morning, Sam").
- **A welcome email** when you create an account, with tips and where to get
  help.
- **Report a problem** from the board menu or the popup: you see exactly
  what's sent (version, browser, plan, and the page only if you tick it), and
  a real person reads it. It works without an account.
- **A gentle ask to rate Rolestash** on the Chrome Web Store, only after
  you've used it for a while, and never more than three times.

### Changed

- **A short film on the rolestash.com homepage:** 21 seconds of saving a job,
  moving it across the board and what Rolestash knows about you. It plays
  silently while on screen, as a vertical cut on phones; with reduced motion
  you see the board picture instead.
- **New pages on rolestash.com:** this changelog, known issues with
  workarounds, and a sitemap, all linked from the footer.
- **rolestash.com is easier to find:** a sitemap, robots.txt and llms.txt;
  clearer titles and descriptions, share cards and structured data on every
  public page; more links between pages; the pricing switch fits small
  phones.
- **Light and dark mode on rolestash.com:** a switch in the header, which
  remembers your choice; the new theme spreads out from the switch.
- **A calmer rolestash.com:** one clear promise, three benefits, the facts
  behind them, answers to common questions and a single Add to Chrome, set in
  Bricolage Grotesque. Plan details moved to the pricing page.
- **Big boards stay quick:** each column shows its first 50 cards, with
  _Show more_ for the rest, so dragging and opening the board don't slow down
  as you add jobs. The count at the top of the column still includes every
  job.
- **Rolestash is on the Chrome Web Store:** rolestash.com's buttons install
  it from the store, Pricing in the menu opens prices in your currency, and
  the email form is now for occasional product news.

### Fixed

- **Sync keeps the latest change when a job is deleted on one device and
  edited on another:** a deletion now counts from when you made it, not when
  it synced, and undoing a deletion brings the job back on every device.
- **Google sign-in works in the Chrome Web Store build:** rolestash.com now
  hands sign-ins to the store's extension as well as the development build.

## [0.4.0] — 2026-10-02

### Added

- **Pro and Advanced can be bought:** payments are live through Paddle, our
  merchant of record, in your own currency.

### Changed

- **More on the free plan:** 30 active jobs (was 15), and autofill for your
  name, contact details, address and links. Pro still fills everything else
  (current role, work rights, salary, saved answers) and can start from your
  résumé.
- **rolestash.com** now leads with what makes Rolestash different: no AI
  reading your applications, no inbox access, no data selling.
- **No name to type:** Account greets you by the first name from your Google
  account or your email address; the display-name field is gone.
- **Round local prices** in the eurozone (€6.50 / €13.99 a month, as in
  Ireland), New Zealand, Switzerland, Sweden, Japan and Canada (plus tax),
  instead of exact conversions; and in Vietnam, Indonesia, Cambodia, Laos and
  Thailand the checkout total is now the round price too (tax included).
- **Regional prices:** lower prices in lower-income countries, set by hand in
  local currency where possible (for example ₹249, R$19.90, MX$79 or US$3 a
  month for Pro), not converted from the US price.
- **Prices in your currency:** Account in the extension and the web board show
  plan prices in your local currency (from Paddle, by location), with US
  dollars as the fallback; rolestash.com links to prices in your currency.

### Fixed

- **A plan cancelled to end at the period's end** now shows "until 2 Nov…
  canceled" instead of "Renews on 2 Nov", and can't be bought twice.
- **Switching plans** now says "You'll be charged A$12.98 now… Then A$22.99 a
  month from 2 Nov", in your own currency throughout (it mixed in US prices),
  and the button's loading spinner no longer squashes into a "[".
- **Saving your profile** in Account works again (it failed on the server).
- **Subscribing from the extension** opens Paddle's checkout again; it got
  stuck on "Opening secure checkout…".

## [0.3.0] — 2026-10-02

### Added

- **rolestash.com/pricing/:** prices in your own currency (from Paddle), a
  monthly/yearly switch and Subscribe buttons that open Paddle's checkout.
  After paying, sign in to Rolestash with the same email and your plan is
  there; if you had no account yet, one is waiting (ADR-0023). Hidden from
  search engines until launch.

### Changed

- **Easier email-updates setup:** choose "I'll forward emails myself"
  (easiest, with a contact card to save), Gmail or Outlook, then follow a few
  short steps. Each step has a button that opens the right page and the text
  to paste. Gmail's confirmation code appears large, with a Copy button, as
  soon as it arrives, and the setup shows "It's working" once your first
  email comes through.
- **"Set up autofill" is a slim suggestion** in the popup and side panel,
  with a ✕ to dismiss it for good, so it no longer pushes the save button
  down.
- **rolestash.com footer:** "Rolestash is an IP of Lumetrix Technologies,
  Australia, ABN: 41 649 439 228", with the Lumetrix mark.
- **Free trial:** new accounts get 14 days of Advanced (was 30 days of Pro),
  still with no card, once per email. Trials already running are unchanged.
- **Switching plans shows the price first:** moving between Pro and Advanced
  now shows what Paddle will charge (or credit) for the rest of the billing
  period, and changes nothing until you confirm. If the payment fails, your
  plan stays as it was.

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
- **Profile photo:** add a photo in Account (the extension or the web board);
  Rolestash greets you by the first name from your Google account or your
  email address, with nothing to type. The photo is shrunk to a small square on your
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
