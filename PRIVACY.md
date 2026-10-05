# Privacy

Rolestash is local-first. On the free plan it keeps everything in your
browser and sends nothing to us. Accounts, sync and email updates are
optional (Pro) and store only what they need. No ads, no
analytics, no crash reporting, no data selling, and no AI services.

Full policy: https://rolestash.com/privacy/

## What the extension reads

- **The page you choose:** the content of a tab, only when you open the
  Rolestash widget (its button on a job site, or the Rolestash icon), use
  its right-click menu item or press its keyboard shortcut on that tab.
- **Job sites:** Rolestash has access to the job sites it supports (SEEK,
  LinkedIn, Indeed, Workday and others) so it can show its button there. The
  button reads nothing from the page and sends nothing anywhere until you
  open it. Rolestash does not track the sites you visit.
- **Pasted links (Pro):** when you paste a job link into _Add job_, Rolestash
  asks for access to that one site, then fetches that one page without your
  cookies. If the page needs JavaScript, it briefly opens the page in a
  background tab instead. Access to the site is removed straight afterwards.

## What is stored on your device

- The job details you save (title, company, location, salary, dates,
  description text, the posting link), your notes, tags, contacts, interview
  rounds, document names and board settings, in the browser's extension
  storage (`chrome.storage.local`).
- **Autofill profile (Pro):** the details you save for filling
  applications stay on this device only. They are not synced, not in backups
  and never sent to us. They go only into the application page you choose,
  when you click "Fill this application". Autofill never answers demographic
  questions and never submits a form. "Fill from résumé" reads your PDF or
  Word file in the browser to pre-fill the profile; the file is never stored
  or sent.

## What is sent to us, and only if you create an account

- **Account:** your email address (and Google account ID if you sign in with
  Google), your plan and subscription status from Paddle, our merchant of
  record, and a display name and small profile photo if you add them. We
  never see card details.
- **Sync (Pro):** a copy of your board and a name for each
  synced device, stored in our database in Sydney, Australia, so your devices
  stay in step. Deleting your account deletes it.
- **Automatic status updates (Pro):** you get a private forwarding
  address and choose which emails to forward. Rolestash never connects to
  your mailbox. Each forwarded email is read in memory with plain rules; we
  keep only the extracted update (such as "interview on 3 Oct", the subject,
  sender and the links it mentions), never the email body, until your board
  fetches it, and 90 days at most.
- **Shared learning (Pro, can be turned off):** when you accept or
  correct an update, your board shares a one-way fingerprint of the email's
  template (with names, companies, numbers, dates and links removed) and
  which company an email domain belongs to, under a one-way code instead of
  your account. Never email text, subjects or which jobs you applied to.
  Untick "Help improve automatic updates" when you create your account, or
  turn it off in Account later, which also withdraws what you shared.

Network: the extension talks only to the page you capture and our Supabase
project. To show plan prices in your currency, our server asks Paddle for
the prices for your location, which means passing on your IP address; it
isn't stored. Checkout, billing and Google sign-in open as pages on rolestash.com,
Paddle and Google that you see. Nothing else.

## Deleting your data

Delete jobs on the board, export a backup at any time, delete your account
from Account (we delete its data within 30 days), or remove the extension,
which deletes its local storage.

This file doubles as the Chrome Web Store privacy disclosure.
