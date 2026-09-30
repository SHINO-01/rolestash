# ADR-0011: Implement accounts with a small Supabase client, server-side trials and an off-by-default build switch

- **Status:** Accepted (Google sign-in superseded by ADR-0012)
- **Date:** 2026-09-30

## Context

ADR-0009 chose Supabase for accounts and Paddle for billing. Implementing
it raises five questions: how the extension talks to Supabase, where trials
and entitlements live, how the free limit is enforced, how Paddle checkout
works without remote code, and how unfinished account features stay out of
release builds while `main` keeps promoting.

## Decision

1. **A small, dependency-free Supabase client** (`src/services/backend/`)
   calls the stable Auth and PostgREST HTTP endpoints we need through an
   injected `fetch`:
   - email code sign-in;
   - PKCE code exchange for Google;
   - token refresh;
   - reading the entitlement;
   - calling Edge Functions.

   We don't use `@supabase/supabase-js`: we use a fraction of it, and it
   would take a large share of the 1 MB package budget
   (`policy/manifest-policy.json`). Our client is fully unit-tested against a
   fake `fetch`.

2. **Sign-in:**
   - **Email code:** a 6-digit code, valid for 10 minutes. A code works
     better than a magic link in an extension, which has no page to land on.
   - **Google:** `chrome.identity.launchWebAuthFlow` with PKCE, redirecting
     to `https://<extension-id>.chromiumapp.org/`.
   - **Storage:** the session lives in `chrome.storage.local`, like every
     other extension that uses Supabase.
3. **Trials and entitlements are server-side** (`supabase/migrations`):
   - A trigger on `auth.users` creates a 30-day trial.
   - A hash of the email in `trial_claims` stops a deleted-and-recreated
     account from getting a second trial.
   - Only Edge Functions (service role) write `entitlements`. RLS lets users
     read only their own row, and pgTAP tests prove it in CI.
   - `public.has_pro()` mirrors `planOf()` for future RLS on sync tables.
4. **The extension caches the entitlement** with `checkedAt`, and
   `planOf()` gives Pro for up to 7 days offline. This is a good-faith client
   gate (ADR-0009): it isn't cryptographically verified, because the code is
   public and forks can remove it anyway. The paywall that matters is
   server-side.
5. **The free limit lives in `JobService`**, through a `PlanProvider`, and
   applies only to _creating_ jobs. Edits, moves, imports and exports are
   never blocked.
6. **Paddle checkout without remote code in the extension:**
   - An Edge Function creates a Paddle transaction with `custom_data.user_id`.
   - The extension opens the returned checkout URL in a tab. That URL is a
     payment page on rolestash.com, the only page allowed to load Paddle.js.
   - The webhook Edge Function verifies Paddle's signature and upserts the
     entitlement. It ignores events older than `last_event_at`.
7. **Off by default:**
   - The account features switch on only when the build has
     `WXT_SUPABASE_URL` and `WXT_SUPABASE_ANON_KEY` (public values).
   - Without them there is no backend, no `identity` permission, no limit and
     no account UI: exactly today's extension.
   - That keeps `main` releasable while Phase 1 is built, and the extension
     repo's manifest-policy gate unchanged until we go live.

## Consequences

- We maintain a small auth client ourselves. The endpoints are stable and
  documented, and a contract test suite covers the requests we send.
- A new CI job (_Database_) runs Postgres in Docker for the pgTAP suite.
- Going live is a deliberate step:
  1. Set the two build variables in the extension repo's release workflow.
  2. Add `identity` to its manifest policy and store listing.
  3. Update PRIVACY.md in the same release.

## Alternatives considered

- **supabase-js:** less code of our own, but a large bundle for the few calls
  we make, plus a service-worker storage adapter to maintain.
- **Trial tracked only in the client:** anyone could reset it by
  reinstalling.
- **Paddle.js inside the extension:** MV3 forbids remote code, and bundling
  Paddle.js isn't supported.
- **A runtime feature flag instead of a build switch:** the permission and
  the network code would still ship, and the permission would change the
  install prompt before we launch.
