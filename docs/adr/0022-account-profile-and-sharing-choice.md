# ADR-0022: Keep a display name, an inline photo and the sharing choice in one account profile

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

The owner asked for two things:

- a profile picture and a name on the account;
- an opt-out of "Help improve automatic updates" (ADR-0019) while setting up
  the account, with sharing still on by default.

Constraints from AGENTS.md:

- **First-party calls only.** Showing the Google profile photo would load an
  image from Google's servers on every board view, so we can't use it.
- **Low overhead.** No new storage service or CDN unless needed.

The sharing switch lives on `email_inboxes`, which only exists once an
Advanced user first opens email updates. That could be weeks after sign-up,
and on another device.

## Decision

- **One table:** `public.account_profiles`, with `display_name`, `avatar` and
  `share_learning`, one row per account.
  - Row-level security: owners only.
  - Column grants: clients write the name and picture; the sharing column
    changes only through `set_email_sharing()`, which also withdraws votes.
  - The row is deleted with the account (cascade).
- **The picture is inline:**
  - the device centre-crops it and resizes it to 128 × 128 (`src/ui/resize-avatar.ts`);
  - it's stored as a WebP data: URL (JPEG where WebP can't be encoded);
  - a database check limits it to 60,000 bytes and to WebP, PNG or JPEG data URLs. No links, no SVG;
  - clients check it again before rendering (`isSafeAvatar`).
- **No picture:** initials on a stable colour.
- **The name** is trimmed, 1–50 characters, with no control characters.
- **Sharing choice at sign-in:**
  - a checkbox, ticked by default, on the extension's and the web board's sign-in;
  - unticking it stores a pending opt-out on the device;
  - `AccountService` sends it with `set_email_sharing(false)` after sign-in,
    and retries on each entitlement refresh until the server has it;
  - `set_email_sharing()` now works before an inbox exists and records the
    choice in `account_profiles`;
  - `my_inbox()` creates new inboxes with that choice.

## Consequences

- No storage bucket, signed URLs or third-party image requests.
- The photo travels with the profile read, which is a single small request.
- A photo is personal data. The privacy policy lists it, and it's deleted
  with the account.
- Re-encoding the photo drops its metadata (for example its location).

## Revision (2026-10-02, later): no name field

The owner asked for the first name to come from the account itself, with no
field to fill in:

- **Google sign-in:** the first word of the name Google gives, kept as
  written. Supabase passes it as `user_metadata.full_name`, which is now kept
  on the session.
- **Email-only sign-up:** a best guess from the address, made by
  `firstNameFrom()`: `sam.taylor` → Sam, `jordanlee88` → Jordanlee.
- The `display_name` column stays, unused, because migrations are
  append-only. The photo remains.

**Bug found while testing:** saving the profile is a PostgREST upsert
(`ON CONFLICT … DO UPDATE SET user_id = …`), and Postgres needs UPDATE on
`user_id` for that, even when nothing conflicts. Every save failed until
`…_profile_upsert_grant.sql`; RLS still limits each user to their own row. A
pgTAP test now runs the exact upsert.

## Revision (2026-10-04): a real name again

ADR-0024 brings the name back as the account's full name: Google's name is
saved automatically, email-code accounts are asked once, and the name goes
to Paddle. The email guess remains only for the greeting's fallback.

## Alternatives considered

- **Google profile photo URL:** a third-party request on every view. Rejected.
- **Supabase Storage bucket:** more moving parts (bucket policies, signed
  URLs, cache rules) for a few kilobytes. Rejected.
- **Supabase `user_metadata` for the sharing choice:** it's editable by the
  user too, but the inbox creation would have to read `auth.users`. A
  normal table is clearer and testable with pgTAP.
