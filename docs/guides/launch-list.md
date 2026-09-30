# Launch list ("Notify me at launch")

People leave their email on rolestash.com to hear when Rolestash launches.
Everything is automated. There's no mailing-list vendor: the list is a
Supabase table, and the emails go through Resend, our existing email
provider.

## The flow

1. **Sign up.** The form at the bottom of the landing page (`#notify`) is a
   plain HTML `<form>`, so it needs no JavaScript. It posts the email and an
   optional plan interest to the `launch-list` Edge Function. The function
   emails a confirmation link (double opt-in) and redirects to
   `/notify/check-email/`.
2. **Confirm.** The link confirms the address and sends the "You're on the
   list" email (the acknowledgement), then redirects to
   `/notify/confirmed/`.
3. **Launch.** On launch day, run **Actions → Announce launch** with the
   Chrome Web Store URL:
   - First run it with _send_ off. That's a dry run that only counts
     recipients.
   - Then run it with _send_ on. It emails every confirmed address in
     batches of 100 and deletes each batch as soon as it's sent, so a retry
     never emails anyone twice. Finally it deletes the unconfirmed
     signups.
4. **Unsubscribe.** Every email after the confirmation has an unsubscribe
   link, plus a `List-Unsubscribe` header, so mail apps show a one-click
   unsubscribe button (RFC 8058). Unsubscribing deletes the address and
   redirects to `/notify/unsubscribed/`.

Anything invalid (a bad address or an unknown link) lands on
`/notify/problem/`.

| Piece             | Where                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| Table and RPCs    | `supabase/migrations/20261001150000_launch_list.sql`, tests in `supabase/tests/database/`                  |
| Function          | `supabase/functions/launch-list/`; logic in `_shared/launch-list.ts`, emails in `_shared/launch-emails.ts` |
| Unit tests        | `tests/unit/functions/launch-list.test.ts`                                                                 |
| Result pages      | `site/notify/{check-email,confirmed,unsubscribed,problem}/`                                                |
| Launch-day action | `.github/workflows/announce-launch.yml`                                                                    |

## Abuse protection

The form could otherwise be used to flood someone's inbox with confirmation
emails.

- **Origin check:** only posts from `https://rolestash.com` (or `www.`) are
  accepted. The site-wide CSP allows this one form action.
- **Honeypot:** a hidden `company` field. Posts that fill it get a success
  page and nothing else.
- **Per address:** at most 3 confirmation emails, at least 10 minutes apart.
  Confirmed addresses never get another one.
- **Globally:** at most 30 confirmation emails per hour.
- **No enumeration:** the response is the same whether or not an email was
  sent.
- **Forgetting:** unconfirmed signups are deleted after 30 days.

## Secrets

Edge Function secrets are set with `supabase secrets set`:

- **`RESEND_API_KEY`:** the Resend key. It's the same key as SMTP
  (`RESEND_SMTP_KEY` in `secrets.env`).
- **`LAUNCH_ADMIN_SECRET`:** authorises the announce action. It's also a
  GitHub Actions secret and stored in `secrets.env`.

Optional: `SITE_URL` (default `https://rolestash.com`), `LAUNCH_FROM` and
`LAUNCH_REPLY_TO`.

If you rotate `LAUNCH_ADMIN_SECRET`, update all three places.

Deploy after changes with:

```bash
npx supabase functions deploy launch-list --project-ref fhclnxqumcdsqxyunelp --use-api
```

CI doesn't deploy functions. The gateway's `verify_jwt` is off for this
function (`supabase/config.toml`), because the form has no JWT.

## Privacy and the law

- **Privacy policy:** it has a "Launch updates" section. Keep it in step
  with any change to what's stored or how long it's kept.
- **Spam Act 2003 (Cth):**
  - consent comes from the double opt-in;
  - every email names the sender;
  - every email after the confirmation has a working unsubscribe link.
