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

**0.6.6**, submitted on 9 October 2026 (Release run 37854408290). It
includes everything in 0.6.3, 0.6.4 and 0.6.5 (0.6.3 was in review and is
replaced by it; 0.6.4 and 0.6.5 never reached the store):

- the guided tour, Help → How do I…? guides, the corner card for boards
  that already have jobs, and a clearer first run;
- a connected inbox reads new mail first, checks every minute while a board
  is open, and notifies when an email changed a card off-screen;
- Connect Gmail only for accounts with a `tester` grant (Google's reviewer)
  until Google verifies the scope;
- another account signing in on the same browser starts clean; signing out
  disconnects the mailbox;
- a smoother tour, steady while a job's drawer slides.

**When it's live (owner and us):** set "Current version" on
`/known-issues/` to 0.6.6 and the date; retake the store screenshots when
convenient (`npm run store:screenshots`; the header now has Help); give
Google the reviewer's sign-in in the Gmail verification form
([gmail-verification.md](guides/gmail-verification.md)).

## Next, in order

**0.6.7**, on `dev`, to submit once 0.6.6 is live (the owner's choice, so
0.6.6's review isn't reset):

- Connect Gmail for every Pro user, before Google's verification, with a
  note on the "unverified app" warning (`GMAIL_FOR_EVERYONE`);
- no empty "Connect your inbox" box when nothing can be connected.

**Before submitting:** the owner sets the Google OAuth app to **In
production**. **The day it's live:** the copy checklist in
[todo.md](todo.md) puts Gmail back on the site, in the policies and in the
store listing.

## Adding to the backlog

When something user-facing lands in the extension on `dev`, add it to the
first unreleased entry above (or start a new one), and keep `CHANGELOG.md`'s
_Unreleased_ section in step with it.
