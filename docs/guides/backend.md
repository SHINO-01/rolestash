# Backend (Supabase + Paddle)

Accounts, trials and billing (ADR-0009, ADR-0011). Everything lives in
`supabase/`:

| Path                        | What                                                               |
| --------------------------- | ------------------------------------------------------------------ |
| `supabase/config.toml`      | Local stack config (auth: 6-digit email codes, 10 min)             |
| `supabase/migrations/*.sql` | Schema, RLS, trial trigger, `has_pro()`; append-only               |
| `supabase/tests/database/`  | pgTAP tests (run in CI as _Database_)                              |
| `supabase/templates/`       | Auth email templates                                               |
| `supabase/functions/`       | Edge Functions (billing webhook, checkout, portal, delete account) |

## Local development

Needs Docker.

```bash
npm run test:db     # start local Postgres, apply migrations, run pgTAP + lint
npm run db:stop     # stop the local stack
```

Rules:

- **Migrations are append-only.** Never edit one that has been applied to
  production. Add a new file:
  `npx supabase migration new <name>`.
- Every table gets RLS in the same migration that creates it, plus pgTAP
  tests that prove other users can't read or write it.
- Clients hold only the anon key. Writes to billing state come only from
  Edge Functions using the service role.

## Environments

| Build                   | Backend                                                                                | Use                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm run build`         | none: accounts off, no `identity` permission                                           | What ships until go-live                                                                       |
| `npm run build:e2e`     | mock (`.env.e2e` → `tests/e2e/mock-backend.ts`)                                        | Automated E2E                                                                                  |
| `npm run build:staging` | real project `fhclnxqumcdsqxyunelp` (`.env.staging`), Paddle **live** since 2026-10-02 | Manual testing of real sign-in and checkout, loaded unpacked from `.output/chrome-mv3-staging` |

The production project lives in Sydney (`ap-southeast-2`). The extension uses
its **publishable** key (`sb_publishable_…`). That key is not a JWT, so the
client sends it only as `apikey`, and sends `Authorization` only with a
user's access token.

**Edge Function auth:** the gateway's `verify_jwt` is **off** for every
function, because it doesn't support the newer JWT signing keys. Each
handler enforces auth itself:

- user endpoints resolve the Bearer token through `/auth/v1/user`;
- the webhook verifies `Paddle-Signature`.

Until the secrets are set, a function answers `503 not_configured`.

**Migrations applied through the Supabase MCP connector** get a connector
timestamp as their version. Rewrite it to the file's version in
`supabase_migrations.schema_migrations`, so `supabase db push` stays in sync.

## Production project (one-time)

1. Create a project on the free plan, region **ap-southeast-2 (Sydney)**
   (the privacy policy says Sydney).
2. Link it and push the schema:
   `npx supabase link --project-ref <ref>`, then `npx supabase db push`.
3. **Auth settings:**
   - Site URL: `https://rolestash.com`.
   - Redirect URL: `https://<extension-id>.chromiumapp.org/`.
   - Email OTP length 6, expiry 600 s.
   - Paste `supabase/templates/sign-in-code.html` into both the _Magic Link_
     and _Confirm signup_ templates.
4. **SMTP:**
   - Custom SMTP through Resend.
   - Sender `Rolestash <noreply@rolestash.com>`.
   - Verify the domain in Resend (it adds DNS records in Cloudflare).
5. **Google sign-in (ADR-0012):**
   - Create an OAuth client (type _Web application_) in Google Cloud.
     - Authorised redirect URI: `https://rolestash.com/auth/google/`.
     - Consent screen authorised domain: `rolestash.com` only.
   - In Supabase, enable the Google provider with that client ID and secret.
     Supabase uses them to verify ID tokens.
   - Keep `uri_allow_list` empty.
   - Allowed extension IDs live in `site/assets/auth-google.js`: the pinned
     dev/staging ID, plus the store ID once assigned.
6. **Build variables** (public, safe to commit to CI settings):
   - `WXT_SUPABASE_URL=https://<ref>.supabase.co`
   - `WXT_SUPABASE_ANON_KEY`
   - `WXT_GOOGLE_CLIENT_ID`
     **Never** put the `service_role` key in the extension, the repo or chat.
     It belongs only in Edge Function secrets.

## Sync (ADR-0016)

Migration `…_sync.sql` adds `devices` and `synced_jobs`. Clients reach them
only through these RPCs, which check the plan and the device:

- `register_device`, which enforces the limits: 5 devices on the paid plan (stored tier `advanced`, ADR-0029)
  devices including the web board;
- `push_jobs`, where the newest edit wins;
- `pull_jobs`, which pages by a revision cursor.

The privileged bodies live in a `private` schema the Data API doesn't
expose (`…_sync_private_schema.sql`). The public RPCs are thin
`SECURITY INVOKER` wrappers, which keeps the security advisor clean.

Users can read and delete their own `devices` rows directly; that's how
the account dialog lists and removes devices. pgTAP covers limits, RLS,
last-writer-wins, lapsed plans and account deletion
(`supabase/tests/database/sync.test.sql`).

## Email status updates (ADR-0014, ADR-0018)

Migration `…_email_updates.sql` adds two tables:

- `email_inboxes`: one forwarding address per Advanced user. It isn't
  readable by clients.
- `email_events`: extracted events only, never email bodies. Owners can
  select and delete through RLS. Events are deleted after 90 days, by
  `ingest_email_event` and by a daily `pg_cron` job.

| RPC                                              | Who                         | What                                                 |
| ------------------------------------------------ | --------------------------- | ---------------------------------------------------- |
| `my_inbox()`                                     | signed in, Advanced         | the address, created on first call                   |
| `rotate_inbox()`                                 | signed in, Advanced         | a new address; mail to the old one is dropped        |
| `ingest_email_event(p_secret, p_token, p_event)` | the Email Worker (anon key) | stores one event: secret, plan and rate-limit checks |

Privileged bodies live in `private`, behind SECURITY INVOKER wrappers, like
sync. `private.plan_tier_of(user)` is `plan_tier()` for any user.

Shared learning (ADR-0019) adds:

- `vote_email_knowledge(p_votes)` and `set_email_sharing(p_on)` for
  Advanced users;
- `private.email_knowledge_votes`, with HMAC voters keyed by
  `private.email_knowledge_key`, which is generated in the database;
- `private.knowledge_lookup()`, which `ingest_email_event` uses on
  arrival;
- a trigger on `auth.users` that deletes a deleted account's votes.

The ingest secret's SHA-256 lives in `private.email_ingest_secret`. To set or
rotate it, see [email-updates.md](email-updates.md#one-time-setup).

## Account profile (ADR-0022)

`account_profiles` holds one row per account:

- `display_name` and `avatar` (a 128-pixel data: URL, at most 60,000 bytes, no
  links or SVG), written by the owner through PostgREST (RLS and column grants);
- `share_learning`, the choice made at sign-up. Only `set_email_sharing()`
  changes it, and `my_inbox()` copies it into a new inbox.

## Website purchases (ADR-0027)

Subscribe on rolestash.com/pricing/ goes to the web board
(`/board/?checkout=<tier>-<interval>`), which signs the buyer in and then
calls `create-checkout`, like the extension. Purchases are never matched to
an account by the email typed at checkout. `PADDLE_ENV` must be `sandbox`
or `production`; anything else stops the functions.

`create-checkout` puts `user_id` and `checkout_sig` (an HMAC of the user id
under the service-role key) in `custom_data`. Anyone opening a Paddle.js
checkout can set `custom_data`, so `paddle-webhook` applies an event only
when:

1. the subscription and customer are already that account's, or
2. `checkout_sig` is valid **and** the customer is already the account's or
   has the account's email.

Otherwise it logs `subscription has no verified account` with the
subscription and customer IDs and ignores the event; refund that purchase
in Paddle.

## Refunds and chargebacks

The refund policy says a refund moves you to Free. When Paddle approves a
full refund or chargeback (`adjustment.*` with `type: full`) of the payment
for the subscription's **current** billing period, `paddle-webhook` cancels
the subscription immediately; Paddle's `subscription.canceled` event then
updates the entitlement as usual. Partial refunds, credits and refunds of an
earlier period's payment keep the plan, and the last of these is logged as
`refund is not for the current period; plan kept`.

## Edge Functions

| Function          | Caller                  | Does                                                                                         |
| ----------------- | ----------------------- | -------------------------------------------------------------------------------------------- |
| `paddle-webhook`  | Paddle (signed, no JWT) | Verifies `Paddle-Signature`, applies `subscription.*` events; ends the plan on a full refund |
| `create-checkout` | Extension (user JWT)    | Creates a Paddle transaction with a signed `custom_data.user_id`; returns its checkout URL   |
| `billing-portal`  | Extension (user JWT)    | Sets the Paddle customer's name from the profile, then returns a one-time portal link        |
| `change-plan`     | Extension (user JWT)    | Moves a live subscription to another billing interval (prorated)                             |
| `delete-account`  | Extension (user JWT)    | Cancels a live subscription immediately, then deletes the user                               |
| `web-handoff`     | Extension (user JWT)    | Single-use sign-in token for the web board (admin `generate_link`; ADR-0017)                 |
| `launch-list`     | rolestash.com form      | Updates-list signup, confirm, unsubscribe and campaign sends (docs/guides/launch-list.md)    |
| `welcome`         | Extension (user JWT)    | Sends the welcome email once per account (claims `welcome_sent_at`; ADR-0024)                |
| `bug-report`      | Anyone (JWT optional)   | Stores a problem report, emails support; 5 an hour per IP (hashed); ADR-0024                 |

`welcome` and `bug-report` need `RESEND_API_KEY` (shared with the launch
list); `ACCOUNT_FROM` and `SUPPORT_EMAIL` are optional overrides. Without
the key they answer 503 and the extension keeps its local fallback.

All the logic is in `supabase/functions/_shared/`. It's plain TypeScript
with injected `fetch`, unit-tested in `tests/unit/functions/` under the same
coverage gate as the core. Each `index.ts` only wires a handler to
`Deno.serve`.

**Deploy (after the project is linked):**

```bash
npx supabase secrets set PADDLE_ENV=sandbox PADDLE_API_KEY=… PADDLE_WEBHOOK_SECRET=… \
  PADDLE_PRICE_PRO_MONTHLY=pri_… PADDLE_PRICE_PRO_QUARTERLY=pri_… PADDLE_PRICE_PRO_YEARLY=pri_… \
  PADDLE_LEGACY_PRICES=pri_…,pri_…   # optional: prices from before ADR-0029
npx supabase functions deploy --project-ref fhclnxqumcdsqxyunelp --no-verify-jwt
```

**Paddle dashboard:**

1. Create the product with two prices: US$7/month and US$59/year.
2. Default payment link: `https://rolestash.com/pay/`.
3. Add a notification destination for
   `https://<ref>.supabase.co/functions/v1/paddle-webhook` with the
   `subscription.*`, `adjustment.created` and `adjustment.updated` events
   (`scripts/paddle-setup.ts --apply` adds any that are missing). Its secret
   is `PADDLE_WEBHOOK_SECRET`.

**Sandbox email caveat:** Paddle's sandbox delivers customer emails
(receipts, confirmations) only to your seller account's email domain. Every
other address is forwarded to the seller account's main email, so test
receipts always land there
([changelog](https://developer.paddle.com/changelog/2024/sandbox-emails-recipient-domain/)).
To check which email a purchase really used, look at the Paddle customer:
`create-checkout` binds every checkout to the Paddle customer for the account
email.

Paddle went live on 2026-10-02: the server and `paddle-config.js` use the
production account. The sandbox catalog is kept, matching, for reference.

### Operations stats (ADR-0026)

`public.ops_stats(secret)` returns counts for the operations dashboard
(accounts, trials, paying by plan, devices, problem reports): no emails,
names or ids. Only the publishable key plus the ops Worker's secret can call
it; its SHA-256 lives in `private.ops_stats_secret`. Rotation:
[operations.md](operations.md).

### Complimentary access (ADR-0025)

To give an account a paid plan with no subscription (the owner's, a tester's),
set its entitlement by hand with the service role (Supabase SQL editor or the
connector). Billing events never change a row with `complimentary` set.

```sql
update public.entitlements
   set status = 'active', tier = 'advanced', trial_ends_at = null,
       current_period_end = '9999-12-31T00:00:00Z', complimentary = 'owner'
 where user_id = (select id from auth.users where email = '<their email>');
```

The account must exist first (sign in once). To remove a grant, set
`complimentary = null` and `status = 'expired'`. List them with
`select user_id, tier, complimentary from public.entitlements where complimentary is not null;`.

### Going live with Paddle

`scripts/paddle-setup.ts` creates or checks the whole catalog idempotently:
products, six prices with local overrides, and the webhook destination. The
sandbox was set up the same way, and a dry run changes nothing.

1. **Owner, in the live Paddle dashboard:**
   - account verification is approved, and `rolestash.com` is an approved
     domain;
   - **Checkout → Checkout settings:** the default payment link is
     `https://rolestash.com/pay/`;
   - **Developer tools → Authentication:**
     - an API key with product, price, customer, subscription, transaction
       and notification-setting permissions goes in `secrets.env` as
       `PADDLE_LIVE_API_KEY`. Never paste it in chat;
     - a client-side token (`live_…`, public).
2. `npx tsx scripts/paddle-setup.ts production`, a dry run. Then the same with
   `--apply`. The webhook secret lands in `secrets.env` as
   `PADDLE_LIVE_WEBHOOK_SECRET`.
3. **Supabase secrets:** `PADDLE_ENV=production`, `PADDLE_API_KEY`
   (the live key), `PADDLE_WEBHOOK_SECRET` (the live secret), and the three
   `PADDLE_PRICE_PRO_*` IDs printed by step 2. Then redeploy the functions.
4. **`site/assets/paddle-config.js`:** `environment: 'production'`, the
   `live_` token and the three live price IDs, in one commit.
   `initPaddle()` refuses a mismatch.
5. **Clear sandbox subscriptions** from test accounts. Their
   `provider_subscription_id` values don't exist in live, so "Manage
   subscription" would fail for them.
6. **A real purchase:** Paddle's "Test and go live" step. Buy Pro monthly
   with a real card, check the plan arrives, then refund it in Paddle.
