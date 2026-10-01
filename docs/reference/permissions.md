# Permissions

Every permission must be justified here. Adding one requires review (and
usually an ADR) because it changes the install prompt and store review.

| Permission         | Why                                                                                                                | Install warning       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ | --------------------- |
| `activeTab`        | Read the job page the user is looking at, only after they click the icon / menu / shortcut                         | none                  |
| `scripting`        | Inject the bundled extractor, or the autofill filler (Advanced; ADR-0020), into that tab                           | none (with activeTab) |
| `storage`          | Save jobs and settings locally                                                                                     | none                  |
| `unlimitedStorage` | Description snapshots can exceed the 10 MB default quota over time                                                 | none                  |
| `contextMenus`     | "Track this job" and "Fill this application" on the page; "Open board" on the toolbar icon                         | none                  |
| `alarms`           | Wakes the worker every 15 minutes to check follow-up reminders and the closing digest (ADR-0015)                   | none                  |
| `identity`         | **Accounts builds only** (ADR-0011): Google sign-in via `launchWebAuthFlow`. Absent from builds without a backend. | none                  |

Not requested, on purpose:

- **Host permissions / `<all_urls>`**: would show "read and change all your data
  on all websites". Only the `e2e` build mode adds it, for Playwright.
- **`tabs`**: not needed; `activeTab` exposes the current tab's URL after a
  gesture, and `runtime.getContexts` finds our own board tab.
- **`favicon`**: tried and removed (see ADR-0002).
  Manifest keys that aren't permissions:

| Key                                        | Why                                                                                                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `externally_connectable` (accounts builds) | Lets **only** `https://rolestash.com/board/*` message the extension, to sign the web board in from this browser's account (ADR-0017). No install warning. |

Optional permissions (requested at the moment of use):

| Permission                                              | Why                                                                                                                                          | Asked when                                                        |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `notifications`                                         | Follow-up reminders and the closing-soon digest (Pro; ADR-0015). Optional so installs show no warning                                        | Setting a first follow-up, or turning on closing alerts (a click) |
| `optional_host_permissions` `https://*/*`, `http://*/*` | Capture from a pasted link (Pro): access to the **one site** of the pasted link, asked for in the click and removed when the capture is done | Clicking _Fill in from link_ in _Add job_                         |

Capture from a pasted link runs in the board page:

- it fetches the page with `credentials: 'omit'` and parses it inertly
  with `DOMParser`, using the same pure extractor;
- for pages that need JavaScript, it falls back to a background tab
  (`tabs.create` plus `scripting`, which the per-site access allows);
- it needs neither an `offscreen` document nor the `tabs` permission.

## Commands

| Command             | Default shortcut | Action                     |
| ------------------- | ---------------- | -------------------------- |
| `_execute_action`   | Alt+J            | Open the popup             |
| `track-current-tab` | Alt+Shift+J      | Instant save, badge result |

Users can rebind them at `chrome://extensions/shortcuts`.
