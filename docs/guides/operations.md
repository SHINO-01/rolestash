# Operations dashboard (operations.rolestash.com)

One page for the owner that shows what needs attention across Paddle,
Resend, Search Console, Cloudflare and GitHub ([ADR-0026](../adr/0026-operations-dashboard.md)).
It is read-only: it never changes anything at a provider.

- **Code:** `infra/ops-worker/` (a Cloudflare Worker, `rolestash-ops`), tests
  in `tests/unit/ops-worker/`.
- **Deploy:** CI deploys it after _Promote to main_, like the site. It has no
  routes and no `workers.dev` URL, so it can't be reached until the steps
  below are done.
- **Fails closed:** without `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` and the
  `OWNER_EMAILS` secret, every request gets 403. With them, only requests
  carrying a valid Cloudflare Access token for an allowed email get in.
- **No storage, no scripts, never cached or indexed.** Each load fetches
  fresh numbers (8-second timeout per panel); a slow or failing provider
  shows an error in its own panel only.

## One-time setup (owner)

Do these in order: Access first, so the hostname is protected before it
points at the Worker.

1. **Cloudflare Access application.** Zero Trust (create the team if asked;
   the free plan covers this) → **Access → Applications → Add an
   application → Self-hosted**:
   - domain `operations.rolestash.com`;
   - a policy **Allow**, **Emails**: your email only;
   - login method: Google, or One-time PIN (a code by email);
   - copy the **Application Audience (AUD) Tag**, and note the team domain
     (`<team>.cloudflareaccess.com`, under Settings → Custom pages).
2. **Tell us the AUD tag and team domain.** Both are public values; we put
   them in `infra/ops-worker/wrangler.jsonc` and deploy.
3. **Your email as a secret** (the repo is public, so it isn't committed):

   ```bash
   npx wrangler secret put OWNER_EMAILS --config infra/ops-worker/wrangler.jsonc
   ```

4. **Custom domain:** Workers & Pages → `rolestash-ops` → Settings →
   Domains & Routes → **Add → Custom domain** → `operations.rolestash.com`.
5. **Open** https://operations.rolestash.com, sign in through Access, and
   check every panel says "Not set up" (no tokens yet).

## Tokens, one per panel (each optional)

Set each with `npx wrangler secret put <NAME> --config infra/ops-worker/wrangler.jsonc`.
A panel without its token shows "Not set up". Rotate them yearly, and at
once if a laptop or account is lost.

| Secret                   | Where to create it                                                                                                                                                                             | Access it needs                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `PADDLE_API_KEY`         | Paddle → Developer tools → Authentication → **New API key**                                                                                                                                    | Read only: Subscriptions, Transactions, Adjustments, Discounts      |
| `CF_ANALYTICS_TOKEN`     | Cloudflare → My Profile → API Tokens → **Create custom token**                                                                                                                                 | Zone → Analytics → Read, for the `rolestash.com` zone only          |
| `GITHUB_TOKEN`           | GitHub → Settings → Developer settings → **Fine-grained token**, repos `rolestash` and `rolestash-extension`                                                                                   | Actions: Read, Dependabot alerts: Read (Metadata: Read is implied)  |
| `GOOGLE_SERVICE_ACCOUNT` | Google Cloud → enable the **Search Console API** → IAM → Service accounts → create one → Keys → JSON. Then Search Console → Settings → Users and permissions → add its email as **Restricted** | The whole JSON key file as the value; Search Console read-only      |
| `RESEND_API_KEY`         | Resend → API Keys                                                                                                                                                                              | **Caution:** Resend has no read-only key; reading needs Full access |

**About Resend:** a Full-access key could also send email or change domains.
Leave `RESEND_API_KEY` unset (the panel says "Not set up") unless you accept
that, and if you do, use a separate key named `ops-dashboard` so it can be
revoked on its own.

## What it shows

| Panel          | Numbers                                                                                                            | Attention when                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| Revenue        | Active, cancelling and past-due subscriptions; sales (7 days); refunds and chargebacks (30 days); active discounts | Anything past due, any chargeback              |
| Email          | Domain status; sent, bounced and spam reports among the latest 100 (7 days)                                        | A bounce, a spam report, a domain not verified |
| Search         | Clicks and views (28 days), top 5 queries, sitemap errors                                                          | A sitemap with errors                          |
| Site           | Requests, 5xx errors and threats blocked (7 days)                                                                  | 5xx above 1%                                   |
| Product health | Latest CI run on `dev`, latest release run, open Dependabot alerts                                                 | A failed run, any open alert                   |
| Accounts       | Not built yet: needs a decision on how the dashboard reads account counts                                          |                                                |

Customer details never appear: counts and statuses only. Each panel links to
the provider's own dashboard for a closer look.
