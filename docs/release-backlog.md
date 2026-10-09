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

**0.6.6** (the guided tour, inbox fixes, account switch, tester-only Gmail),
live on 9 October 2026, after 0.6.1.

## In review

**0.6.7**, submitted on 9 October 2026 (Release run 37910816346):

- Connect Gmail for every Pro user, before Google's verification, with a
  note on the "unverified app" warning (`GMAIL_FOR_EVERYONE`);
- no empty "Connect your inbox" box when nothing can be connected.

**Owner, before it goes live:** the Google OAuth app must be **In
production**. **The day it's live:** the copy checklist in
[todo.md](todo.md) puts Gmail back on the site, in the policies and in the
store listing; set known issues to 0.6.7; retake the store screenshots when
convenient (`npm run store:screenshots`; the header now has Help).

## Next, in order

Nothing waiting.

## Adding to the backlog

When something user-facing lands in the extension on `dev`, add it to the
first unreleased entry above (or start a new one), and keep `CHANGELOG.md`'s
_Unreleased_ section in step with it.
