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

The screenshots and the Free line are in the dashboard (7 Oct 2026).

## Next, in order

### 1. 0.6.0: referrals and account security

- **State:** released and packaged on 7 October 2026: tag `v0.6.0`, release
  PR [SHINO-01/rolestash-extension#17](https://github.com/SHINO-01/rolestash-extension/pull/17)
  merged, GitHub Release built. The **Release** run
  [37586728791](https://github.com/SHINO-01/rolestash-extension/actions/runs/37586728791)
  is **waiting at the Chrome Web Store approval** on purpose.
- **Contains:** "Invite friends" in Account (referral link, Copy, Share, New
  link, counts); discount codes; a dated complimentary grant shows its end
  date; the phone web board QR code in Account → Sync; an optional password,
  sign out everywhere and two-step sign-in (ADR-0036).
- **Ship it, after 0.5.0 is approved:** approve that run's `chrome-web-store`
  deployment (or run **Release** again if it has expired; approvals time out
  after 30 days). Then, in the dashboard:
  - **Privacy tab → Authentication information:** paste the new text from
    `store/listing.md`. It now covers the optional password (a salted hash at
    Supabase Auth) and the two-step secret key.
  - **Description:** paste it again (the QR code and sign-in options lines).

## Adding to the backlog

When something user-facing lands in the extension on `dev`, add it to the
first unreleased entry above (or start a new one), and keep `CHANGELOG.md`'s
_Unreleased_ section in step with it.
