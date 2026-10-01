# ADR-0017: Serve a phone-first web board at rolestash.com/board/, built in CI from the extension's code

- **Status:** Accepted
- **Date:** 2026-10-01

## Context

Advanced promises "a web board for your phone" (ADR-0013). Chrome extensions
don't run on phones, so it has to be a website. The rest of rolestash.com is
hand-written static HTML that runs no scripts (except checkout and the Google
sign-in hand-off), under a strict CSP. The owner chose:

- **Scope:** quick updates from a phone, made genuinely useful for Advanced.
- **Build:** a separate app built in CI, reusing the extension's code.

## Decision

- **Where it lives:** a React app in `src/web/` with its entry in `web/`.
  Vite builds it into `site/board/`, which is gitignored:
  - CI builds it before deploying the site, and `npm run verify` builds it
    too;
  - it reuses the extension's `domain/`, `services/`, `storage/` and `ui/`
    code unchanged (none of it imports extension APIs).
- **Storage:** an IndexedDB `KeyValueStore`, with BroadcastChannel for
  cross-tab change events. It holds a local copy of the board, so the web
  board works offline and syncs as a `web` device (ADR-0016). The server
  allows `web` devices only on Advanced.
- **What it does:**
  - **Today:** follow-ups that are due or coming up, saved jobs closing
    within 3 days, the count per column, and recent changes.
  - **Board:** column tabs and search.
  - **Job sheet:** move the job to another column, set a follow-up, edit
    notes, open the posting, archive.
  - **Quick add:** a job by hand.
  - **Account:** the plan, synced devices and sign-out.

  Capture stays in the extension; a browser tab can't read other sites.

- **Sign-in:** three ways.
  - **Emailed code:** Supabase OTP.
  - **Google:** the existing flow (ADR-0012), with `state.e = "web"`, so
    `/auth/google/` forwards the answer to `/board/` on the same site. The
    board checks `state` against the attempt it saved in `sessionStorage`
    before exchanging the ID token.
  - **Automatically, from the extension:** when the board opens signed out,
    it messages the Rolestash extension in this browser. The extension's
    `externally_connectable` key allows only `rolestash.com/board/*`.
    1. If the extension is signed in, it calls the `web-handoff` function
       with its own session.
    2. The function returns a single-use, 10-minute token minted with
       Supabase's admin `generate_link`; no email is sent.
    3. The board exchanges the token at `/auth/v1/verify` for **its own**
       session. Sharing the extension's refresh token would break, because
       Supabase rotates refresh tokens.

  The session lives in IndexedDB. Pro and Free accounts see what Advanced
  adds, plus checkout.

- **Signing out clears the browser:** it removes this device from sync and
  deletes the local copy, so a shared or borrowed browser keeps nothing.
- **Its own CSP on `/board/*`:**
  - `script-src 'self'`, with no inline code (Vite emits only files);
  - `connect-src` only to our Supabase project;
  - `manifest-src 'self'` for the add-to-home-screen manifest.

  Hashed assets are cached for a year; the HTML is never cached.

- **Tests:** a Playwright `web` project serves the E2E build with the real
  CSP, pointed at the mock backend. It covers the plan gate, Today, the
  board, quick updates, quick add and sync back, and fails on any console
  error.

## Consequences

- **The site now has a build step,** but only for `/board/`. The
  hand-written pages stay script-free, and their tests skip the built
  directory.
- **Signing out of the board** sets a flag, so the extension doesn't sign
  it straight back in. Signing in on the board clears the flag.
- **No push notifications:** reminders still pop up from the extension. The
  web board shows them on Today.
- **Privacy:** the policy covers the web board's local copy and how
  signing out clears it.

## Alternatives considered

- **Hand-written JavaScript in `site/`:** it keeps the no-build rule, but it
  would duplicate the domain and sync logic without their tests.
- **Read-only:** smaller, but a board you can't update from your phone isn't
  worth an Advanced plan.
- **Full board parity:** duplicates the whole extension UI. Desktop editing
  belongs in the extension.
- **localStorage:** its 5 MB quota is too small for long descriptions on 95
  jobs plus history.
