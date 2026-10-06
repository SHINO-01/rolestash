# ADR-0032: Connect Gmail or Outlook, read on the device

- **Status:** Accepted
- **Date:** 2026-10-06
- Extends ADR-0014 (email status updates) and ADR-0018 (the forwarding
  Worker), which stay as the way in that gives no inbox access. Amends
  AGENTS.md rule 1.

## Context

Email updates needed a forwarding filter that people had to set up in Gmail
or Outlook, and many never did. The owner wants the board updated from job
email automatically, like the tools Rolestash competes with, "even when the
browser is closed, or as soon as it opens".

Reading mailboxes on our servers would update the board with every browser
closed, but Gmail's `gmail.readonly` is a restricted scope: data on our
servers means Google's yearly third-party security assessment (CASA), and
every user's mail passing through infrastructure we'd have to secure.
Reading in the extension keeps mail on the user's computer.

## Decision

- **Connect, read-only, on Pro:** "Connect Gmail" (Google, `gmail.readonly`)
  or "Connect Outlook" (Microsoft identity platform, `Mail.Read`
  `offline_access`) in Account. One mailbox at a time.
- **Read on the device:** `MailboxService` lists new inbox mail since its
  cursor, oldest first. Gmail's own search does the first cut (recruiting
  systems, employers on the board, job words in the subject; no promotions or
  social); `likelyJobEmail()` checks each sender and subject; only those
  emails are downloaded in full (30 per check at most) and turned into the
  engine's `EmailInput` (`src/email/mailbox.ts`). The same engine, matching
  and apply/suggest/unsorted steps as forwarded mail run on them
  (`EmailUpdateService.run`). Nothing from the mailbox goes to our servers;
  the resulting job updates sync like any edit.
- **When:** at browser startup (`runtime.onStartup`), every 5 minutes while a
  mailbox is connected (`rolestash.mail` alarm), and when a board opens or
  regains focus. With every browser closed nothing is read; the board is up
  to date seconds after Chrome opens, and sync carries it to the phone.
- **Tokens:** Google gives browser apps no refresh token, so Gmail renews by
  `prompt=none` with the account as `login_hint` through
  `launchWebAuthFlow({ interactive: false })`; if the Google session is gone,
  Account shows "Reconnect". Outlook is a public client with PKCE and a
  refresh token (no secret in the extension). Tokens live in
  `chrome.storage.local` under `mailbox:auth`, never synced or exported;
  Disconnect deletes them and revokes Google's.
- **No shared learning from connected mail:** votes need the server's
  ticket proving the email arrived (ADR-0028), which only forwarded mail
  has.
- **Config:** `WXT_GMAIL_CLIENT_ID` (usually the sign-in web client, with
  the Gmail scope and the extension's `chromiumapp.org` redirect added, set
  only once Google approves) and `WXT_MICROSOFT_CLIENT_ID`. Each provider is
  hidden without its ID, so releases can ship before either is set up.

## Consequences

- Google must verify the app for a restricted scope (consent-screen review,
  a demo video, the privacy policy's Limited Use statement). Until then,
  only up to 100 test users can connect Gmail, behind an "unverified app"
  warning. Microsoft needs publisher verification for a clean consent screen.
- The site, privacy policy and listing no longer say "never in your inbox";
  they say mail is read on your computer, never on our servers, and that
  forwarding needs no inbox access at all.
- Network calls now include Google and Microsoft mail APIs (AGENTS.md rule 1).

## Alternatives considered

- **Server-side reading (Gmail push, Graph subscriptions):** updates with the
  browser closed, at the cost of CASA every year, a mail-processing service
  to secure, and mail on our servers. Possible later, as its own decision.
- **Forwarding only, smarter rules:** keeps "no inbox access", but the setup
  step is what stopped people using it.
- **Open and click tracking of sent mail (snov.io-style):** not built; it
  tracks recruiters without their consent, and image pre-loading makes opens
  unreliable.
