# Release backlog (Chrome Web Store)

Extension releases waiting their turn. The store reviews one submission at a
time: submitting a new version while one is in review means cancelling that
review and starting again at the back of the queue. So releases go out
**one at a time, in this order**, each after the previous one is approved.

How a release ships: [releasing.md](guides/releasing.md). Changes that need
no store review (the website, the web board, Edge Functions, the database,
the operations dashboard) go live when CI deploys them and are not listed
here, except where a release depends on them.

_Last updated 9 October 2026._

## Live

**0.6.1** (five lanes, Rejected back as a lane), live on 9 October 2026. It
followed 0.6.0 (referrals, discount codes, phone QR, optional password,
two-step sign-in, sign out everywhere).

## In review

**0.6.3** (guided tour, Help guides, a clearer first run; Connect Gmail
hidden until Google verifies it), submitted on 9 October 2026 (Release run
37825928875). When it's live, set "Current version" on `/known-issues/` to
0.6.3 and the date. The store screenshots still show the old header (no
Help button); retake them when convenient (`npm run store:screenshots`).

## Next, in order

### 1. 0.6.4: connected inbox fixes, notifications, Google's reviewer

- **State:** released on `dev` on 9 October 2026. Its Release run waits at
  the Chrome Web Store approval; approve it once 0.6.3 is live (submitting
  sooner restarts 0.6.3's review).
- **Contains:**
  - a connected inbox reads new mail first, not two weeks of backlog;
  - an open board checks a connected inbox every minute, and a system
    notification says when an email changed a card off-screen;
  - Check now says when it was skipped or couldn't reach the inbox;
  - Connect Gmail for accounts with a `tester` grant only (Google's
    reviewer), everyone else waits for verification;
  - another account signing in on the same browser starts clean: sync,
    the connected mailbox and email updates reset, and the previous
    account's jobs wait for Keep or Remove instead of syncing.
- **Owner, before Google reviews:** the reviewer account is set up (tester
  grant, password in your password manager); give its sign-in to Google in
  the verification form ([gmail-verification.md](guides/gmail-verification.md)).

## Adding to the backlog

When something user-facing lands in the extension on `dev`, add it to the
first unreleased entry above (or start a new one), and keep `CHANGELOG.md`'s
_Unreleased_ section in step with it.
