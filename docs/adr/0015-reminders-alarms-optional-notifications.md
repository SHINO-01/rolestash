# ADR-0015: Run reminders on `alarms`, with `notifications` as an optional permission

- **Status:** Accepted
- **Date:** 2026-10-01

## Context

Pro promises two reminders (ADR-0013):

- **Follow-ups:** "remind me to chase this application on Friday";
- **Closing-date alerts:** a warning before a saved job closes.

Both must work while the board is closed, with no server (local-first),
and without adding install warnings for everyone. Most users are on Free
and can't use reminders at all.

## Decision

- **`alarms`** (required; no install warning) wakes the service worker every
  15 minutes. The worker stays stateless: `ReminderService.run()` reads the
  jobs, decides what's due with pure rules (`src/domain/reminders.ts`), and
  records what it sent under the `reminders` storage key.
- **`notifications`** is an **optional permission**. The board requests it
  inside the click that sets a first follow-up or turns closing alerts on.
  Until it's granted, follow-ups still show on the card, with an "Allow
  notifications" link. Nobody sees a "Display notifications" install
  warning.
- **Follow-ups:**
  - Stored as an optional `followUpAt` on the job; it's user-editable, so
    it appears in the timeline.
  - Presets (tomorrow, 3 days, a week, 2 weeks) or a date, at 09:00 local
    time.
  - One notification per job, or a single summary when more than 3 are due
    at once.
  - A click opens the job's card.
- **Closing digest:**
  - Once per local day, from 09:00.
  - Lists jobs you haven't applied to (active stage that doesn't mark
    applied, no `appliedAt`) that close within 3 days.
  - It can be turned off from the board menu (`settings.closingAlerts`).
- **Plans:** reminders run on Pro and Advanced. On Free the drawer offers
  them instead. Builds without accounts aren't limited, as with job
  limits.
- **Sent state lives outside the jobs:** `reminders` holds `{ lastDigest,
notified: jobId → followUpAt }`. Sending never changes a job, so it adds
  no timeline noise and makes no sync writes. The key isn't backed up.

## Consequences

- The manifest gains `alarms`, and `optional_permissions: ["notifications"]`.
- **Timing:** reminders fire within 15 minutes of their time, and only while
  Chrome is running. Chrome also catches up on missed alarms after sleep.
- **Worker listeners:** the notifications API only exists once the
  permission is granted. The worker registers its click listener at
  startup and again on `permissions.onAdded`.
- No network calls, no new data leaving the device, and nothing to change in
  PRIVACY.md.

## Alternatives considered

- **Required `notifications`:** simpler, but every install (mostly Free
  users) would see a "Display notifications" warning for a feature they
  can't use.
- **Scheduling one alarm per reminder:** exact timing, but alarms would have
  to be rescheduled on every edit, import and sync. Polling every 15
  minutes is stateless and cheap.
- **Recording "notified" on the job:** would add timeline entries and sync
  writes for something the user didn't do.
