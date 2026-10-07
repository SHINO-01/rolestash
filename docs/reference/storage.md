# Storage layout & migrations

All data lives in `chrome.storage.local` (with `unlimitedStorage`). A backup
(Export backup) holds only `settings` and the jobs; nothing else below is in it.

| Key                       | Value                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `meta`                    | `{ schemaVersion: number }`                                                                                                  |
| `settings`                | `Settings`                                                                                                                   |
| `job:<id>`                | `Job` (one key per job)                                                                                                      |
| `account:session`         | Supabase session (accounts builds only; not backed up)                                                                       |
| `account:second-step`     | A sign-in waiting for its authenticator code (ADR-0036); never used for calls, removed on success or cancel                  |
| `account:entitlement`     | Cached entitlement + `checkedAt` (accounts builds only)                                                                      |
| `reminders`               | Reminders already sent (ADR-0015); not backed up                                                                             |
| `sync:state`              | Sync cursor, device id and what was last synced (ADR-0016); not backed up                                                    |
| `sync:lock`               | Short lease so two contexts don't sync at once                                                                               |
| `sync:deletions`          | When each job was deleted on this device (up to 1,000), so its tombstone carries that time; not backed up                    |
| `email:state`             | Email updates: event cursor, threads, taught senders, unsorted updates, Gmail code (ADR-0014); not backed up                 |
| `profile`                 | Autofill profile (ADR-0020); this device only: not synced, not backed up                                                     |
| `account:welcomed`        | Account id the welcome email was requested for (ADR-0024); the server sends it once                                          |
| `account:name-skipped`    | Account id whose one-time name question was skipped on this device (ADR-0024)                                                |
| `prompts:rating`          | Store-rating prompt: first visit, times asked, snooze, done (ADR-0024); this device only, not backed up                      |
| `email:lock`              | Short lease so two contexts don't apply email updates at once                                                                |
| `account:profile`         | Display name and picture, cached for showing offline (ADR-0022)                                                              |
| `account:sharing-opt-out` | An opt-out of shared learning chosen at sign-in, until the server has it (ADR-0022)                                          |
| `account:prices`          | Plan prices in this user's currency, cached for a day (ADR-0013, ADR-0029)                                                   |
| `mailbox:state`           | A connected Gmail or Outlook mailbox: which provider and how far it has been read (ADR-0032); not backed up                  |
| `mailbox:auth`            | That mailbox's access (and, for Outlook, refresh) token; never synced, exported or sent anywhere but the provider (ADR-0032) |
| `widget:position`         | Where the widget's button sits: left or right edge, and how far down (ADR-0030)                                              |
| `widget:allSites`         | "Show the button on all sites" is on; the background registers the content script for every page (ADR-0033)                  |
| `widget:hiddenSites`      | Hostnames where "Hide on this site" was chosen (ADR-0030)                                                                    |
| `tips:pinDismissed`       | The board's "Pin Rolestash" tip was dismissed                                                                                |
| `tips:autofillDismissed`  | The widget's "Set up autofill" tip was dismissed                                                                             |

Access only through `JobRepository` / `SettingsRepository`
(`src/storage/`), which depend on the `KeyValueStore` port.

- **Writes** are validated with zod; an invalid job throws before touching storage.
- **Reads** skip (and log) invalid records so one bad entry can't break the board.
- **Change events**: `repository.subscribe()` fires for writes from any
  extension context (widget, board, worker).

## Migrations

`src/storage/migrations.ts` holds an ordered list of
`{ version, description, up(store) }`. `migrate(store)` runs on first use in
every context (`services.ready`) and on install/update in the worker.

Rules:

1. **Append, never edit** a released migration.
2. **Idempotent**: may run concurrently from two contexts.
3. **Forward-only**: stored version > code version ⇒ `SchemaTooNewError`
   (the user downgraded; refuse rather than corrupt).
4. **Mirror in backups**: add the same transformation to `upgradeBackup()`
   in `storage/backup.ts`, keyed on the backup's `schemaVersion`.
5. **Test it** in `tests/unit/storage/storage.test.ts`: seed the old shape,
   migrate, assert the new shape.

Versions:

- **v1**: seed default settings.
- **v2** (0.5.0, ADR-0034): Screening and Withdrawn retired. Their jobs move
  to Interviewing and Rejected with a new `updatedAt`, so sync sends them on;
  a withdrawn job gets a "Withdrawn → Rejected" timeline entry dated when it
  was withdrawn. Because 0.4.7 devices keep syncing the old ids, the same
  mapping (`domain/retired-stages.ts`) runs on every read and write in
  `JobRepository` and `SettingsRepository`, on sync pull (which sends the
  cleaned job back), and on backup import, whatever the backup's version.

Optional fields added without a migration:

- `archivedAt`: History, with the `archived` and `unarchived` activity types.
- `followUpAt`: reminders.
- `contacts`, `rounds`, `documents`: per-job records (Pro).
- `interview`, `suggestion`, and the `email_update` activity type (with
  `email`, `setInterview`, `undone`): email status updates (ADR-0014).
- `suggestion.templateTicket`: the server's vote ticket (ADR-0028).
- `settings.closingAlerts`: absent means on.
- `stage.archived`: custom columns. Archived columns are hidden from the
  board and pickers, but kept so jobs and History still name them.

When do you need one? Adding an **optional** field: no. Renaming, removing,
changing a type, making a field required, or changing semantics: yes.

### Template

```ts
{
  version: 2,
  description: 'Rename job.notes → job.journal',
  up: async (store) => {
    const all = await store.get(null);
    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith('job:')) continue;
      const job = value as Record<string, unknown>;
      if ('journal' in job) continue; // idempotent
      updates[key] = { ...job, journal: job.notes ?? '', notes: undefined };
    }
    if (Object.keys(updates).length) await store.set(updates);
  },
},
```

## History

| Version | Change                         |
| ------- | ------------------------------ |
| 1       | Initial schema; seeds settings |
