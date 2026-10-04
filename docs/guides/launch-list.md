# Updates list ("Notify me at launch")

People leave their email on rolestash.com to hear when Rolestash launches.
Everything is automated. There's no mailing-list vendor: the list is a
Supabase table, and the emails go through Resend, our existing email
provider.

## The flow

1. **Sign up.** The form at the bottom of the landing page (`#notify`) is a
   plain HTML `<form>`, so it needs no JavaScript. It posts the email and an
   optional plan interest to the `launch-list` Edge Function.
   - The form's fine print states the consent: launch day plus occasional
     product news.
   - The function emails a confirmation link (double opt-in). That email
     already has a one-click "Remove this address" link.
   - Then it redirects to `/notify/check-email/`.
2. **Confirm.** The link confirms the address and sends the "You're on the
   list" email (the acknowledgement), then redirects to
   `/notify/confirmed/`.
3. **Launch.** ~~Run **Actions → Announce launch**~~: not planned (owner,
   2026-10-05). The workflow and the `launch` campaign stay in the code but
   aren't used. Note the deployed function's confirmation still mentions
   launch day until it's redeployed (see [launch.md](launch.md#7-going-public)).
4. **Product news.** Add a file to `emails/news/` (format in its README),
   then run **Actions → Send product news** with the file's name.
5. **Unsubscribe.** It's deliberately effortless.
   - Every email, including the confirmation, ends with a one-click link.
     It needs no sign-in and asks nothing.
   - Every email also carries `List-Unsubscribe` and
     `List-Unsubscribe-Post` headers, so Gmail, Outlook and Apple Mail show
     their own button (RFC 8058).
   - Replies go to support@rolestash.com. Remove anyone who asks by
     replying: see below.
   - Unsubscribing deletes the row at once, and `/notify/unsubscribed/`
     offers "Sign up again".

**How sends work (launch and news):**

- Every send is a named campaign.
- Run with _send_ off first. That's a dry run: it shows the recipient count
  and the subject.
- It emails confirmed addresses in batches of 100 and records the campaign
  on each address after its batch. A rerun after a failure skips everyone
  who already got that campaign.
- Confirmed addresses are kept until their owner unsubscribes. Unconfirmed
  signups are deleted after 30 days.

**Removing someone by hand** (for example, after a reply asking to stop).
In the Supabase SQL editor, run:

```sql
delete from public.launch_subscribers where email = lower('person@example.com');
```

Anything invalid (a bad address or an unknown link) lands on
`/notify/problem/`.

| Piece          | Where                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Table and RPCs | `supabase/migrations/20261001150000_launch_list.sql`, `…160000_launch_list_news.sql`; tests in `supabase/tests/database/` |
| Function       | `supabase/functions/launch-list/`; logic in `_shared/launch-list.ts`, emails in `_shared/launch-emails.ts`                |
| Unit tests     | `tests/unit/functions/launch-list.test.ts`                                                                                |
| Result pages   | `site/notify/{check-email,confirmed,unsubscribed,problem}/`                                                               |
| Sending        | `.github/workflows/announce-launch.yml`, `.github/workflows/send-news.yml`, `emails/news/`                                |

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

- **Privacy policy and terms:** the privacy policy has a "Launch and
  product news emails" section, and the terms have §8, "Emails from us".
  Keep both in step with any change to what's stored, how often we email,
  or how opting out works.
- **No tracking:** the policy promises no tracking pixels or tracked links.
  Keep open and click tracking **off** on the `rolestash.com` domain in
  Resend (it's off now).
- **Frequency:** we promised "a few emails a year at most".
- **Spam Act 2003 (Cth):**
  - consent comes from the double opt-in;
  - every email names the sender;
  - every email has a working unsubscribe link, honoured immediately (the
    Act allows up to 5 business days).
