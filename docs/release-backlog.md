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

| Version | Submitted  | What                                                           | When approved                                                                                                                                                 |
| ------- | ---------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.4.7   | 6 Oct 2026 | Button on job sites by default, all sites by choice (ADR-0033) | Check the dashboard's Privacy tab matches `store/listing.md`; set `/known-issues/` current version to 0.4.7; then ship 0.5.0 below. 0.4.3 is live until then. |

## Next, in order

### 1. 0.5.0: four board lanes (ADR-0034)

- **State:** tagged `v0.5.0`; release PR
  [SHINO-01/rolestash-extension#16](https://github.com/SHINO-01/rolestash-extension/pull/16)
  open with Integration passing (screenshots and one listing line).
- **Contains:** Saved, Applied, Interviewing, Offer lanes; Rejected off the
  board; Screening and Withdrawn retired (storage migration v2).
- **Ship it:** after 0.4.7 is approved, merge #16, run **Release**, approve
  the submission; in the dashboard upload the five screenshots and paste the
  changed Free line from `store/listing.md`.

### 2. 0.6.0: referrals in Account

- **State:** on `dev` under _Unreleased_ in `CHANGELOG.md`; not tagged.
- **Contains:** "Invite friends" in Account (referral link, Copy, Share, New
  link, counts); a dated complimentary grant shows its end date.
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
