# ADR-0036: Account security: no required password; optional password with reset, and optional two-step sign-in

- **Status:** Accepted (owner, 2026-10-07). Steps 1 and 2 built for 0.6.0;
  two-step sign-in (step 3) next.

## As built (steps 1 and 2)

- **Strength check:** `src/domain/password.ts`, with zxcvbn-ts and its
  common-password list, loaded only when someone types a new password.
  12–128 characters, zxcvbn score 3 or more, nothing from the email or
  "rolestash". Supabase's own minimum is 12 too.
- **The reset page is the web board,** not a separate `/auth/reset/`: the
  reset email links to `rolestash.com/board/?reset=1`, which already has the
  bundled checker and the Supabase connection its CSP allows. It reads the
  link's one-time session from the address, clears it from the address bar,
  sets the new password, then signs out every session (`scope=global`).
- **Has a password?** Supabase doesn't say, so setting one also sets
  `user_metadata.has_password`, which only drives the wording in Account.
- **Removing a password** isn't offered: Supabase Auth has no way to.
- **Security-change emails** are Supabase's own notifications ("Password
  changed"), with our template (`supabase/templates/password-changed.html`),
  instead of a function of ours.
- **Two-step sign-in (next)** must also be enforced by the database: once an
  account has a verified authenticator, row-level security has to refuse
  sessions without the second step (`aal2`), or the app check alone could be
  skipped by calling the API directly.

- Builds on ADR-0011 (accounts: email code via Supabase Auth) and ADR-0012
  (Google sign-in). The free plan still needs no account.

## Context

Accounts exist only for Pro (and its trial): sign-in is a **6-digit code
emailed** by Supabase Auth or **Google**. There are no passwords. The owner
asked whether security standards require a username and password, and wants
users prompted to set a strong one, with a password reset page.

### Do standards require a password? No.

- **NIST SP 800-63B** treats a one-time code sent to the user (and federated
  sign-in such as Google) as valid single-factor authentication for consumer
  services at AAL1. It does not require a memorised secret. (Email codes
  don't count as a _second_ factor at AAL2, which nobody here is claiming.)
- **OWASP's Authentication guidance** favours passwordless or
  phishing-resistant methods; passwords are the weakest common factor
  (reuse, credential stuffing, phishing, breach liability).
- **A password with an email reset is never stronger than the email**: anyone
  who controls the inbox can reset it. So a password alone adds risk (one more
  secret to steal and stuff) without raising the security ceiling.
- **Paddle, Chrome Web Store and the privacy policy** don't require passwords
  either.

What genuinely raises the bar for an account holding a job search is a
**second factor** (an authenticator app) or **passkeys**, not a password.

## Decision (recommended)

1. **Passwords are optional, never required, and not pushed.** Email code and
   Google stay the defaults. Under Account → Security, "Add a password" is
   offered for people who prefer typing one (for example, slow email). We
   don't nag after upgrade; the account dialog shows one quiet line:
   "Optional: add a password or two-step sign-in."
2. **When someone does set a password, it must be strong:**
   - at least 12 characters, no maximum below 64, any characters, no forced
     rotation or composition rules (NIST);
   - checked on the device against a bundled strength estimator (no network)
     and rejected if guessable (a common password, the email, "rolestash");
   - Supabase Auth stores it (bcrypt); we never see or log it;
   - Supabase's leaked-password check (Have I Been Pwned, k-anonymity) is
     switched on **if** the project moves to a Supabase plan that includes it;
     until then the bundled estimator and a bundled list of the most common
     breached passwords cover the worst cases.
3. **Password reset page:** `rolestash.com/auth/reset/`. "Forgot password"
   (extension, web board, website) sends Supabase's recovery email; its link
   opens the reset page, which accepts only that recovery session, asks for
   the new password twice with the same strength check, then signs out every
   other session. The page follows the site's CSP and `noindex` rules, like
   `/auth/google/`.
4. **Optional two-step sign-in (TOTP):** Supabase Auth MFA with an
   authenticator app, offered next to the password. When on, every sign-in (code,
   Google or password) asks for the 6-digit app code; recovery codes are shown
   once. This is the step that meaningfully protects an account.
5. **Hardening that applies to everyone, whatever they choose:**
   - sign-in and reset requests stay rate-limited (Supabase's limits, plus our
     per-IP limits on our own endpoints);
   - the same generic response whether or not an email has an account (no
     account enumeration), on sign-in, code and reset;
   - an email to the user when a password or two-step sign-in is added,
     changed or removed, and when the password is reset;
   - "Sign out everywhere" in Account → Security.
6. **Passkeys later:** when Supabase Auth supports WebAuthn passkeys
   generally, offer them as the preferred upgrade over passwords (a separate
   ADR).

### If the owner wants the prompt anyway

The build supports "Prompt to set a password after upgrading" as a
setting-free variant: one dismissible card after the first Pro sign-in,
"Add a password or two-step sign-in", never shown again once dismissed.
Recommended against a password-only prompt, for the reasons above.

## What it touches

- `src/services/backend/supabase-client.ts`, `account-service.ts`: password
  sign-in, set/change password, MFA enrol/verify/unenrol, sign out everywhere.
- Extension Account dialog (`features/account/`): a Security section; sign-in
  form gains "Use a password" and "Forgot password".
- Web board sign-in (`src/web/`): the same options.
- Website: `site/auth/reset/` (new page, its tests and CSP), `_headers`.
- Emails: security-change notices (`emails/`, Resend), alongside the welcome
  email.
- Supabase: Auth settings (password provider on, minimum length, MFA TOTP on,
  redirect URL for `/auth/reset/`), no new tables.
- Privacy policy: passwords are stored hashed by Supabase; TOTP secrets are
  stored by Supabase Auth; nothing new is shared.
- Tests: unit (strength rules, flows with the mock backend), e2e (set password,
  sign in with it, reset, TOTP enrol and sign in), site tests for the reset
  page.

## Build order

1. Strength checker + "Add a password" + password sign-in + reset page.
2. Security-change emails and "Sign out everywhere".
3. Two-step sign-in (TOTP) with recovery codes.

About one to two days in total. Supabase Auth settings changes are
owner-approved steps (live project).

## Consequences

- No new mandatory step: free users still need no account; Pro still signs in
  with a code or Google in seconds.
- People who want a password get a safe one; people who want real protection
  get two-step sign-in.
- More account surface to test and support (reset, lost authenticator), which
  recovery codes and support guidance cover.

## Alternatives considered

- **Require a password for every Pro account:** worse security (reuse and
  stuffing), more support (resets), and no higher ceiling than the email.
- **Keep it passwordless with nothing new:** fine by the standards, but no
  stronger option for people who want one.
- **SMS codes as the second factor:** SIM-swap risk and per-message cost;
  authenticator apps are free and stronger.
