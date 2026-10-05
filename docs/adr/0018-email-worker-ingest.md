# ADR-0018: Receive forwarded email in a Cloudflare Email Worker that holds only a single-purpose ingest secret

- **Status:** Accepted
- **Date:** 2026-10-01

## Context

ADR-0014 routes each Advanced user's forwarding address
(`<token>@in.rolestash.com`) to a Cloudflare Email Worker. The Worker reads
the email, runs the rules in `src/email` and stores the extracted event in
Supabase. The plan was to give the Worker the **service-role key**. That key
bypasses row-level security on every table: if it leaked from the Worker,
every account, entitlement and synced job could be read or changed.

The Worker needs to do exactly one thing: add an event for the inbox that
owns a given address.

## Decision

- **One RPC, one secret:** the Worker calls
  `ingest_email_event(p_secret, p_token, p_event)` with the project's
  publishable key and a dedicated **ingest secret**.
  - The secret is 256 random bits. It's a Worker secret
    (`EMAIL_INGEST_SECRET`) and lives nowhere else.
  - The database keeps only its SHA-256, in
    `private.email_ingest_secret`.
- **The function does every check, in the database:**
  - the secret;
  - that the address is known;
  - that the owner is on Advanced. If not, the inbox is marked
    `paused_at`, so the extension can say so once;
  - per-address rate limits: 30 events an hour, 200 a day. They're kept in
    the database because a Worker has no shared memory between requests;
  - one event per Message-ID;
  - 90-day retention, also run daily by `pg_cron`.
- **Least privilege for the anon role:**
  - `anon` may execute this one function (through a SECURITY INVOKER
    wrapper, like sync) and nothing else in `private`;
  - the inbox table isn't readable by any client role. Users get their
    address through `my_inbox()`.
- **The Worker:**
  - accepts every message and then stores it or drops it **silently**.
    Bouncing would tell a sender which addresses exist;
  - drops mail larger than 3 MiB unread;
  - logs only the outcome (`email: stored`), never the address or content;
  - has no HTTP surface: `workers_dev` and `preview_urls` are off.
- **Deploys:** CI deploys it after "Promote to main", like the site Worker
  and with the same token (Workers Scripts: Edit). The Email Routing rule
  that sends `*@in.rolestash.com` to it is set up once by the owner in the
  dashboard.

## Consequences

- **A leaked Worker secret is narrow:** it can only add events for
  addresses the holder already knows. The addresses are 100-bit bearer
  tokens, so it can't read anything or reach other data. Rotate it with
  `wrangler secret put EMAIL_INGEST_SECRET` and a new hash.
- **Ingest is exposed to anon:** the function is reachable with the public
  key, so it must keep rejecting calls without the secret. A pgTAP test
  covers this.
- **Check before analysing** (added October 2026): the Worker first calls
  `email_inbox_check` (same secret and rules as ingest, no event), so mail
  to an unknown, paused or rate-limited address is never parsed or
  analysed. Ingest still checks everything itself.
- **Small bundle:** the Worker bundles `src/email` without zod, at about
  180 KiB (a test guards it). The engine takes well under a millisecond per
  email, inside the Workers free plan's CPU limit.

## Alternatives considered

| Option                                               | Why not                                                                                             |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Service-role key in the Worker (the original plan)   | Full database access from an internet-facing component; a leak exposes everything                   |
| An Edge Function between the Worker and the database | Another moving part and hop. It would still need a shared secret with the Worker, so it isn't safer |
| A custom Postgres role signed into a JWT             | Needs the project's JWT signing secret in the Worker, which is worse                                |
| Rate limits in the Worker (Cloudflare rate-limiting) | Per location and approximate; the database count is exact and also covers retries                   |
