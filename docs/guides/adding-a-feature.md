# Adding a feature

A worked path through the layers, using "follow-up reminders" as the example.

1. **Domain.** Add the data to the schema: `followUpAt: IsoDateTime.optional()`
   on `JobSchema`; add it to `EDITABLE_FIELDS` if users edit it. Pure helpers
   (e.g. `isFollowUpDue(job, now)`) go in `domain/`. Unit-test them.
2. **Storage.** New _optional_ fields need no migration (old records still
   parse). Renaming/removing/making required **does**: add a migration in
   `storage/migrations.ts`, mirror it in `upgradeBackup()` in `storage/backup.ts`,
   test both. See [storage reference](../reference/storage.md).
3. **Service.** Add a use case to `JobService` (or a new service registered in
   `services/container.ts`). Services take ports, never `chrome.*`.
4. **Platform.** If the feature needs a browser API (e.g. `chrome.alarms`,
   `chrome.notifications`), wrap it in `platform/` behind a small interface
   defined in `services/ports.ts`. Add the permission to `wxt.config.ts` and
   justify it in [permissions](../reference/permissions.md).
5. **Background.** Event wiring (alarms firing) goes in
   `entrypoints/background.ts`, delegating to services immediately.
6. **UI.** Feature components in `features/<feature>/`, shared primitives in
   `ui/components/`. Read data with `useJobs()` / `useSettings()`; write through
   `useServices().jobService` and call `live.applyLocal(changed)` for instant feedback.
7. **Tests.** Unit tests for domain/service logic; an E2E test in
   `tests/e2e/` if the feature has a user-visible flow.
8. **Docs.** Update the relevant reference page, the roadmap, the CHANGELOG,
   and write an ADR if you made a non-obvious choice.
