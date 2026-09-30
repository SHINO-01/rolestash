# Permissions

Every permission must be justified here. Adding one requires review (and
usually an ADR) because it changes the install prompt and store review.

| Permission         | Why                                                                                                                | Install warning       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ | --------------------- |
| `activeTab`        | Read the job page the user is looking at, only after they click the icon / menu / shortcut                         | none                  |
| `scripting`        | Inject the bundled extractor into that tab                                                                         | none (with activeTab) |
| `storage`          | Save jobs and settings locally                                                                                     | none                  |
| `unlimitedStorage` | Description snapshots can exceed the 10 MB default quota over time                                                 | none                  |
| `contextMenus`     | "Track this job" on the page; "Open board" on the toolbar icon                                                     | none                  |
| `identity`         | **Accounts builds only** (ADR-0011): Google sign-in via `launchWebAuthFlow`. Absent from builds without a backend. | none                  |

Not requested, on purpose:

- **Host permissions / `<all_urls>`**: would show "read and change all your data
  on all websites". Only the `e2e` build mode adds it, for Playwright.
- **`tabs`**: not needed; `activeTab` exposes the current tab's URL after a
  gesture, and `runtime.getContexts` finds our own board tab.
- **`favicon`**: tried and removed (see ADR-0002).
- **`notifications` / `alarms`**: will be needed for follow-up reminders
  (roadmap); add them with that feature.

Future "paste a link" capture will use `optional_host_permissions`, requested
at the moment of use for the specific site.

## Commands

| Command             | Default shortcut | Action                     |
| ------------------- | ---------------- | -------------------------- |
| `_execute_action`   | Alt+J            | Open the popup             |
| `track-current-tab` | Alt+Shift+J      | Instant save, badge result |

Users can rebind them at `chrome://extensions/shortcuts`.
