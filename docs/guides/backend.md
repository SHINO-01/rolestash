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

| Build                   | Backend                                                              | Use                                                                                            |
| ----------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm run build`         | none: accounts off, no `identity` permission                         | What ships until go-live                                                                       |
| `npm run build:e2e`     | mock (`.env.e2e` → `tests/e2e/mock-backend.ts`)                      | Automated E2E                                                                                  |
| `npm run build:staging` | real project `fhclnxqumcdsqxyunelp` (`.env.staging`), Paddle sandbox | Manual testing of real sign-in and checkout, loaded unpacked from `.output/chrome-mv3-staging` |

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

- `register_device`, which enforces the limits: Pro 3 computers, Advanced 5
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

## Edge Functions

| Function          | Caller                  | Does                                                                                      |
| ----------------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| `paddle-webhook`  | Paddle (signed, no JWT) | Verifies `Paddle-Signature`, applies `subscription.*` events                              |
| `create-checkout` | Extension (user JWT)    | Creates a Paddle transaction with `custom_data.user_id`; returns its checkout URL         |
| `billing-portal`  | Extension (user JWT)    | Returns a one-time Paddle customer-portal link                                            |
| `change-plan`     | Extension (user JWT)    | Moves a live subscription between Pro and Advanced (prorated)                             |
| `delete-account`  | Extension (user JWT)    | Cancels a live subscription immediately, then deletes the user                            |
| `web-handoff`     | Extension (user JWT)    | Single-use sign-in token for the web board (admin `generate_link`; ADR-0017)              |
| `launch-list`     | rolestash.com form      | Updates-list signup, confirm, unsubscribe and campaign sends (docs/guides/launch-list.md) |

All the logic is in `supabase/functions/_shared/`. It's plain TypeScript
with injected `fetch`, unit-tested in `tests/unit/functions/` under the same
coverage gate as the core. Each `index.ts` only wires a handler to
`Deno.serve`.

**Deploy (after the project is linked):**

```bash
npx supabase secrets set PADDLE_ENV=sandbox PADDLE_API_KEY=… PADDLE_WEBHOOK_SECRET=… \
  PADDLE_PRICE_PRO_MONTHLY=pri_… PADDLE_PRICE_PRO_YEARLY=pri_… \
  PADDLE_PRICE_ADVANCED_MONTHLY=pri_… PADDLE_PRICE_ADVANCED_YEARLY=pri_…
npx supabase functions deploy
```

**Paddle dashboard:**

1. Create the product with two prices: US$7/month and US$59/year.
2. Default payment link: `https://rolestash.com/pay/`.
3. Add a notification destination for
   `https://<ref>.supabase.co/functions/v1/paddle-webhook` with the
   `subscription.*` events. Its secret is `PADDLE_WEBHOOK_SECRET`.

**Sandbox email caveat:** Paddle's sandbox delivers customer emails
(receipts, confirmations) only to your seller account's email domain. Every
other address is forwarded to the seller account's main email, so test
receipts always land there
([changelog](https://developer.paddle.com/changelog/2024/sandbox-emails-recipient-domain/)).
To check which email a purchase really used, look at the Paddle customer:
`create-checkout` binds every checkout to the Paddle customer for the account
email.

Use the sandbox until Paddle approves the account, then switch
`PADDLE_ENV=production` and the production keys and prices.
