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
5. **Google provider:**
   - Create an OAuth client (type _Web application_) in Google Cloud.
   - Add the Supabase callback URL, then paste the client id and secret into
     the Google provider settings.
6. **Build variables** (public, safe to commit to CI settings):
   `WXT_SUPABASE_URL=https://<ref>.supabase.co` and `WXT_SUPABASE_ANON_KEY`.
   **Never** put the `service_role` key in the extension, the repo or chat.
   It belongs only in Edge Function secrets.

## Edge Functions

| Function          | Caller                  | Does                                                                              |
| ----------------- | ----------------------- | --------------------------------------------------------------------------------- |
| `paddle-webhook`  | Paddle (signed, no JWT) | Verifies `Paddle-Signature`, applies `subscription.*` events                      |
| `create-checkout` | Extension (user JWT)    | Creates a Paddle transaction with `custom_data.user_id`; returns its checkout URL |
| `billing-portal`  | Extension (user JWT)    | Returns a one-time Paddle customer-portal link                                    |
| `delete-account`  | Extension (user JWT)    | Cancels a live subscription immediately, then deletes the user                    |

All the logic is in `supabase/functions/_shared/`. It's plain TypeScript
with injected `fetch`, unit-tested in `tests/unit/functions/` under the same
coverage gate as the core. Each `index.ts` only wires a handler to
`Deno.serve`.

**Deploy (after the project is linked):**

```bash
npx supabase secrets set PADDLE_ENV=sandbox PADDLE_API_KEY=… PADDLE_WEBHOOK_SECRET=… \
  PADDLE_PRICE_MONTHLY=pri_… PADDLE_PRICE_YEARLY=pri_…
npx supabase functions deploy
```

**Paddle dashboard:**

1. Create the product with two prices: US$7/month and US$59/year.
2. Default payment link: `https://rolestash.com/pay/`.
3. Add a notification destination for
   `https://<ref>.supabase.co/functions/v1/paddle-webhook` with the
   `subscription.*` events. Its secret is `PADDLE_WEBHOOK_SECRET`.

Use the sandbox until Paddle approves the account, then switch
`PADDLE_ENV=production` and the production keys and prices.
