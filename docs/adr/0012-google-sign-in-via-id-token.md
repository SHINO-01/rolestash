# ADR-0012: Sign in with Google through rolestash.com and an ID token, and pin the extension ID

- **Status:** Accepted (replaces the Google part of ADR-0011)
- **Date:** 2026-10-01

## Context

With Supabase's hosted Google flow, Google's account chooser says "continue
to fhclnxqumcdsqxyunelp.supabase.co". That looks suspicious to customers.
It also blocks Google's brand verification: every authorised domain on the
consent screen must be one we can prove we own.

Supabase's only built-in fix is its Custom Domain add-on (Pro plan +
add-on, about US$35/month), which conflicts with the near-zero cost goal.

The hosted flow also needed Supabase to allow redirects to
`https://*.chromiumapp.org/**`, which covers _every_ Chrome extension.
Another extension could have run our sign-in flow and received a session for
a user it tricked into consenting.

## Decision

1. **The extension talks to Google directly, using the OpenID Connect
   implicit flow.**
   - `chrome.identity.launchWebAuthFlow` opens Google with
     `response_type=id_token`.
   - `redirect_uri` is `https://rolestash.com/auth/google/`.
   - `nonce` is SHA-256(random), and `state` = {extension ID, random}.
   - Google now shows "continue to rolestash.com". After brand verification
     it can show the name Rolestash and the logo.
2. **`rolestash.com/auth/google/` is a static page that hands the result
   back to the extension.**
   - It reads the URL fragment and forwards it unchanged to
     `https://<id>.chromiumapp.org/`, only when `<id>` is on its allowlist.
   - The fragment never reaches any server.
   - The page loads only our own script, sends no referrer and is never
     cached.
3. **The extension checks the result, then asks Supabase for a session.**
   - It rejects a `state` that isn't this attempt's.
   - It exchanges the ID token with Supabase
     (`/auth/v1/token?grant_type=id_token`, provider `google`, raw nonce).
   - Supabase verifies the token's signature, its audience (our client ID)
     and the nonce hash.
4. **The extension ID is pinned.**
   - Development, staging and E2E builds carry a manifest `key`, giving the
     fixed ID `bdajnmkjahhphadpdbbkibljcheonejp`. It's a public key only; no
     private key was kept.
   - Production builds omit `key`, and the Chrome Web Store assigns the
     published ID. At launch that ID joins the allowlist in
     `site/assets/auth-google.js`.
5. **Supabase allows no OAuth redirects at all** (`uri_allow_list` is
   empty). Email sign-in uses codes and needs none.

## Consequences

- The Google OAuth client needs `https://rolestash.com/auth/google/` as an
  authorised redirect URI. `supabase.co` can then be removed from the consent
  screen's authorised domains, which unblocks brand verification.
- The Google client ID is public build configuration (`WXT_GOOGLE_CLIENT_ID`).
  Google sign-in is offered only when it is set and the project has Google
  enabled.
- **The allowlist and the manifest key must stay in step.** A site test
  derives the ID from `DEV_EXTENSION_KEY` and checks the page allows it.
- **Adding a new extension ID** (the store ID, or an Edge build) means one
  line in `auth-google.js` and a site deploy. No backend change is needed.

## Alternatives considered

| Option                                          | Why not                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Supabase Custom Domain (`auth.rolestash.com`)   | ~US$35/month. Revisit when revenue covers it; this design keeps working either way.               |
| Proxy Supabase Auth through a Cloudflare Worker | Supabase builds Google's `redirect_uri` from its own URL, so Google would still show supabase.co. |
| Keep the wildcard redirect                      | Any extension could run our flow and get sessions.                                                |
| `chrome.identity.getAuthToken`                  | Chrome-only, returns an access token (not an ID token), and doesn't cover the Edge build.         |
