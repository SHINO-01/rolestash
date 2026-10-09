# Privacy

Rolestash is local-first. On the free plan it keeps everything in your
browser and sends nothing to us unless you send a problem report. Accounts, sync and email updates are
optional (Pro) and store only what they need. No ads, no
analytics, no crash reporting, no data selling, and no AI services.

Full policy: https://rolestash.com/privacy/

## What the extension reads

- **The page you choose:** the content of a tab, only when you open the
  Rolestash widget (its button on the page, or the Rolestash icon), use its
  right-click menu item or press its keyboard shortcut on that tab.
- **Web pages:** Rolestash has access to the job sites it supports (SEEK,
  LinkedIn, Indeed, Workday and others), and to every other site only if you
  turn on "Show the button on all sites", so its button can sit at the edge
  of the page. On each page it checks only
  whether a job posting is open (the address, and the page's job data), so
  the button can say "Save job". Nothing is read beyond that, stored or sent
  anywhere until you open the panel. Rolestash does not track or record the
  sites you visit, and you can hide the button on any site.
- **Pasted links (Pro):** when you paste a job link into _Add job_, Rolestash
  asks for access to that one site, then fetches that one page without your
  cookies. If the page needs JavaScript, it briefly opens the page in a
  background tab instead. Access to the site is removed straight afterwards.

## What is stored on your device

- The job details you save (title, company, location, salary, dates,
  description text, the posting link), your notes, tags, contacts, interview
  rounds, document names and board settings, in the browser's extension
  storage (`chrome.storage.local`).
- **Autofill profile:** the details you save for filling
  applications stay on this device only. They are not synced, not in backups
  and never sent to us. They go only into the application page you choose,
  when you click "Fill this application". Autofill never answers demographic
  questions and never submits a form. "Fill from résumé" reads your PDF or
  Word file in the browser to pre-fill the profile; the file is never stored
  or sent.

## What is sent to us, and only if you create an account

- **Password (only if you add one):** stored by Supabase Auth as a salted
  hash (bcrypt); we never see or store the password itself. It's checked for
  strength on your device before it's sent.
- **Two-step sign-in (only if you turn it on):** Supabase Auth keeps the
  authenticator app's secret key, so it can check your codes. We never see
  your codes.
- **Account:** your email address (and Google account ID if you sign in with
  Google), your plan and subscription status from Paddle, our merchant of
  record, and a display name and small profile photo if you add them. We
  never see card details.
- **Complimentary Pro (only if we give it to you, for example as a tester):**
  why and until when. If we set it up before you have an account, we keep a
  keyed hash of your email and its first two letters and domain (such as
  "da…@example.com") until you sign in or the grant ends.
- **Referrals (only if you use a referral link or share yours):** your
  referral code, which account referred which, the payment it came from and
  whether a reward was given, plus a keyed hash of a referred friend's email
  so each friend counts once. A referral link carries its code to checkout in
  that browser tab only (no cookies). Referrers see only how many friends
  joined, never who.
- **Offer emails:** if you have an account, we may occasionally email you a
  discount or news of the referral programme, never more than one a week.
  We keep a random opt-out token for your account, when we last emailed an
  offer and whether you opted out. Every offer has a one-click opt-out.
  Sent through Resend.
- **Sync (Pro):** a copy of your board and a name for each
  synced device, stored in our database in Sydney, Australia, so your devices
  stay in step. Deleting your account deletes it.
- **Connected mailbox (Pro, if you connect Gmail):** read-only access, read
  in the extension on your computer. Connecting Gmail is paused for everyone
  but Google's reviewers until Google approves it (mailboxes connected
  earlier keep working); Outlook can't be connected yet. It looks at the
  sender and subject of new inbox mail to pick out job emails, downloads
  only those, and keeps the update it finds on the job's card, with the
  email's subject, sender and date as the reason, never the email. Emails
  and the access token are never sent to Rolestash's servers; with sync on,
  the card (update and reason included) syncs like any other change.
  Disconnect, or signing out, deletes the token (and revokes Google's).
  Rolestash's use of information from Google APIs adheres to the Google API
  Services User Data Policy, including the Limited Use requirements.
- **Automatic status updates by forwarding (Pro):** you get a private forwarding
  address and choose which emails to forward. Rolestash never connects to
  your mailbox. Each forwarded email is read in memory with plain rules; we
  keep only the extracted update (such as "interview on 3 Oct", the subject,
  sender and the links it mentions), never the email body, until your board
  fetches it, and 90 days at most.
- **Shared learning (Pro, can be turned off):** when you accept or
  correct an update, your board shares a one-way fingerprint of the email's
  template (with names, companies, numbers, dates and links removed) and
  which company an email domain belongs to, under a one-way code instead of
  your account, used only once five paying accounts agree. Never email
  text, subjects or which jobs you applied to.
  Untick "Help improve automatic updates" when you create your account, or
  turn it off in Account later, which also withdraws what you shared.

Network: the extension talks only to the page you capture, our Supabase
project (when you sign in, sync, use Pro features or send a problem report)
and, if you connect Gmail, Google's Gmail API directly. To show plan prices
in your currency, our server asks Paddle for the prices for your location,
which means passing on your IP address; it's held in memory for up to 10
minutes and never saved. Checkout, billing and Google sign-in open as pages
on rolestash.com, Paddle and Google that you see. Nothing else.

## Deleting your data

Delete jobs on the board, export a backup at any time, delete your account
from Account (we delete its data within 30 days), or remove the extension,
which deletes its local storage.

This file doubles as the Chrome Web Store privacy disclosure.
