# Gmail verification (restricted scope)

How to get `gmail.readonly` verified by Google, so "Connect Gmail"
(ADR-0032) works without the "Google hasn't verified this app" screen.

The project's **brand** is already verified (name, logo, domain, privacy
policy). That covers sign-in only. `gmail.readonly` is a **restricted**
scope and needs its own review: Google Cloud → Google Auth Platform → **Data
access** → the restricted scopes section → fill in the form below.

Until Google approves, keep `WXT_GMAIL_CLIENT_ID` **unset** in the
rolestash-extension repository, so release builds hide "Connect Gmail".
Google's form warns against shipping unverified scopes to production users.
Staging builds have it, for testing and the video.

## The form

**What features will you use?** Pick the option for reading email to report
or monitor something for the user (Google's Gmail policy lists, for example,
"track flight or package delivery status"; a job application's status is the
same kind of use). If the list also has an email productivity option, it can
go with it; don't pick anything about sending, composing or backups.

**How will the scopes be used?** (995 of 1,000 characters)

> Rolestash is a job application tracker for Chrome. A user who opts in connects Gmail so their job board updates itself when employers reply: a rejection moves the job's card to Rejected, an interview invite adds the date and meeting link. gmail.readonly lets the extension search the inbox for likely job emails (from recruiting systems, from employers already on the user's board, or with job words in the subject), check their sender and subject, and download only those in full. gmail.metadata is not enough: the outcome and the interview details are in the message body. We never send, change, label or delete mail. Mail is processed inside the extension on the user's device; email content is never sent to or stored on our servers, and the access token stays on the device. Only the result (the new status, interview time and link, and the email's subject, sender and date as the reason) is kept on the job's card. If the user turns on optional sync, their cards sync to their own account.

Every claim matches the code; keep it that way if the code changes:

| Claim                                     | Where                                                                             |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| Search narrows to likely job mail         | `gmailQuery` in `src/services/mail/gmail.ts`                                      |
| Sender and subject first, full mail after | `format=metadata` then `format=full` in `GmailClient`                             |
| Read only, nothing sent or changed        | only `messages.list`, `messages.get`, `profile`                                   |
| On the device, token on the device        | `MailboxService` (`mailbox:auth` in local storage)                                |
| What's kept                               | `EmailNoteSchema` and `JobInterviewSchema` on the job (`src/domain/job.ts`)       |
| Synced only with sync on                  | Sync (Pro, optional) copies job cards, including that note, to the user's account |

The last row matters for Google's **security assessment** (CASA). It's
required for apps that can reach restricted data "from or through a
third-party server". Gmail calls go straight from the extension to Google,
and no email is sent to us, but the update derived from an email (subject,
sender, date, interview details) can reach our database through sync. Say so
plainly if asked; don't describe the app as never storing anything. If Google
asks for an assessment, we decide then: do it, or stop syncing the
mail-derived note and resubmit.

**Demo video:** a YouTube link, **Unlisted**, in English, 2 to 4 minutes, no
music needed. The script is below.

## Recording the video

Record on the **staging** build, not the store version: Google's form says
not to put unverified scopes in front of production users.

**Before you record**

1. `npm run build:staging`, then load `.output/chrome-mv3-staging` unpacked
   in `chrome://extensions` (Developer mode → Load unpacked). It has its own
   extension ID, whose redirect URI is already registered.
2. Sign in to the board with the Pro account (Account → Sign in).
3. In Google Cloud → Audience, make sure the Gmail account you'll connect is
   a **test user** (while the app is unverified).
4. Add a job: **Add job** → Frontend Engineer at Northwind Labs, lane
   Applied.
5. From a **second** email account, display name "Northwind Labs Careers",
   send the connected Gmail address:
   - Subject: `Interview invitation: Frontend Engineer at Northwind Labs`
   - Body: thanks for applying to the Frontend Engineer role at Northwind
     Labs, an invitation to a video interview on a date next week at 10:00 am
     with a time zone, and a meeting link, e.g.
     `https://meet.google.com/abc-defg-hij`.
6. Screen recorder at full screen; make sure the browser's address bar is
   visible (reviewers look for the client ID in the consent screen's URL).

**Shots**

1. **(10 s) What it is.** The board with the Northwind Labs card in Applied.
   Narrate or caption: "Rolestash tracks job applications. Connecting Gmail
   lets it update cards when employers reply."
2. **(20 s) Where to connect.** Account → Email updates → **Connect Gmail**.
   Pause on the text explaining mail is read on this computer.
3. **(40 s) The OAuth grant, slowly.** The Google window opens.
   - **Zoom into the address bar.** Show `client_id=681262997873-…` and
     `scope=…gmail.readonly`.
   - Pick the account. The **unverified app** screen appears: Google
     expects it in the video. Click Advanced → Go to Rolestash.
   - The consent screen shows the app name **Rolestash** and "View your email
     messages and settings". Hold on it, then Continue.
4. **(15 s) Connected.** Back on the board: "Gmail connected ·
   address@gmail.com".
5. **(40 s) What the scope does.** Click **Check now**. The Northwind Labs
   card moves to **Interviewing** and shows the interview time. (If Rolestash
   is less sure, the card shows the update as a suggestion instead: click
   **Accept** on camera.) Open the
   card: the interview date, the meeting link, and the email's subject and
   sender as the reason. Caption: "Only this update is kept; the email isn't
   copied."
6. **(15 s) Read-only.** Show the original email in Gmail, unchanged: still
   unread or read as before, no label, nothing sent.
7. **(15 s) Disconnect.** Account → Email updates → **Disconnect**. Then
   show myaccount.google.com → Security → Third-party connections: Rolestash
   no longer has access (Disconnect revokes Google's token).

Upload to YouTube as **Unlisted** and paste the link in the form.

## After Google approves

1. Set `WXT_GMAIL_CLIENT_ID` in rolestash-extension (Settings → Secrets and
   variables → Actions → Variables) to the client ID in `docs/todo.md`.
2. Release the next version; "Connect Gmail" appears for everyone.
3. Untick this in `docs/todo.md`.
