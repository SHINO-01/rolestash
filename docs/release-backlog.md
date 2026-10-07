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

| Version | Submitted  | What                                                                                                                 | When approved                                                                                               |
| ------- | ---------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 0.6.0   | 7 Oct 2026 | Referrals in Account, discount codes, phone QR, password, two-step, sign out everywhere; includes 0.5.0's four lanes | Set `/known-issues/` current version to 0.6.0 and the date. 0.4.7 (approved 7 Oct 2026) is live until then. |

- **How it went:** the owner approved the waiting **Release** run
  [37586728791](https://github.com/SHINO-01/rolestash-extension/actions/runs/37586728791)
  on 7 October 2026 (07:29 UTC, 18:29 Sydney) while 0.5.0 was still in
  review, so 0.6.0 took 0.5.0's place in the queue. 0.6.0 carries everything
  0.5.0 had (the four board lanes, ADR-0034); the five screenshots and the
  Free line were already in the dashboard.
- **Owner, now:** in the dashboard, paste the new **Privacy → Authentication
  information** text and the description from the release repo's
  `store/listing.md` (the optional password, kept by Supabase Auth only as a
  salted hash, and the two-step secret key). If the dashboard says editing
  would restart the review, do it anyway: the disclosure must match what
  0.6.0 does.

## Next, in order

Nothing queued. Add the next release here when something user-facing lands
under _Unreleased_ in `CHANGELOG.md`.

## Adding to the backlog

When something user-facing lands in the extension on `dev`, add it to the
first unreleased entry above (or start a new one), and keep `CHANGELOG.md`'s
_Unreleased_ section in step with it.
