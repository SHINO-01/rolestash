# Storage layout & migrations

All data lives in `chrome.storage.local` (with `unlimitedStorage`).

| Key                   | Value                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| `meta`                | `{ schemaVersion: number }`                                                                                  |
| `settings`            | `Settings`                                                                                                   |
| `job:<id>`            | `Job` (one key per job)                                                                                      |
| `account:session`     | Supabase session (accounts builds only; not backed up)                                                       |
| `account:entitlement` | Cached entitlement + `checkedAt` (accounts builds only)                                                      |
| `reminders`           | Reminders already sent (ADR-0015); not backed up                                                             |
| `sync:state`          | Sync cursor, device id and what was last synced (ADR-0016); not backed up                                    |
| `sync:lock`           | Short lease so two contexts don't sync at once                                                               |
| `email:state`         | Email updates: event cursor, threads, taught senders, unsorted updates, Gmail code (ADR-0014); not backed up |
| `profile`             | Autofill profile (ADR-0020); this device only: not synced, not backed up                                     |
| `email:lock`          | Short lease so two contexts don't apply email updates at once                                                |

Access only through `JobRepository` / `SettingsRepository`
(`src/storage/`), which depend on the `KeyValueStore` port.

- **Writes** are validated with zod; an invalid job throws before touching storage.
- **Reads** skip (and log) invalid records so one bad entry can't break the board.
- **Change events**: `repository.subscribe()` fires for writes from any
  extension context (popup, board, worker).

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

Optional fields added without a migration:

- `archivedAt`: History, with the `archived` and `unarchived` activity types.
- `followUpAt`: reminders.
- `contacts`, `rounds`, `documents`: per-job records (Advanced).
- `interview`, `suggestion`, and the `email_update` activity type (with
  `email`, `setInterview`, `undone`): email status updates (ADR-0014).
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
