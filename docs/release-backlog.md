# Release backlog (Chrome Web Store)

Extension releases waiting their turn. The store reviews one submission at a
time: submitting a new version while one is in review means cancelling that
review and starting again at the back of the queue. So releases go out
**one at a time, in this order**, each after the previous one is approved.

How a release ships: [releasing.md](guides/releasing.md). Changes that need
no store review (the website, the web board, Edge Functions, the database,
the operations dashboard) go live when CI deploys them and are not listed
here, except where a release depends on them.

_Last updated 7 October 2026._

## In review

| Version | Submitted  | What                                | When approved                                                                                                         |
| ------- | ---------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 0.5.0   | 7 Oct 2026 | Four board lanes (ADR-0034, PR #16) | Set `/known-issues/` current version to 0.5.0; then ship 0.6.0 below. 0.4.7 (approved 7 Oct 2026) is live until then. |

Owner, now: in the dashboard, upload the five screenshots from the release
repo's `store/screenshots/` and paste the changed Free line from
`store/listing.md`.

## Next, in order

### 1. 0.6.0: referrals and account security

- **State:** on `dev` under _Unreleased_ in `CHANGELOG.md`; not tagged.
- **Contains:** "Invite friends" in Account (referral link, Copy, Share, New
  link, counts); discount codes; a dated complimentary grant shows its end
  date; the phone web board QR code in Account → Sync; an optional password,
  sign out everywhere and two-step sign-in (ADR-0036).
- **Already live without it:** referral links, codes at checkout, the web
  board's Account section, and the dashboard (all deployed 7 Oct 2026). Until
  this ships, extension users find their link on the web board.
- **Ship it:** after 0.5.0 is approved: `npm run release -- minor` on `dev`
  (fix the date to Sydney's), push, then the release-repo PR (no permission or
  listing change expected; check `store/listing.md` mentions referrals if you
  want them in the description).

## Adding to the backlog

When something user-facing lands in the extension on `dev`, add it to the
first unreleased entry above (or start a new one), and keep `CHANGELOG.md`'s
_Unreleased_ section in step with it.
