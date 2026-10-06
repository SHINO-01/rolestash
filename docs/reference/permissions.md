# Permissions

Every permission must be justified here. Adding one requires review (and
usually an ADR) because it changes the install prompt and store review.

| Permission         | Why                                                                                                                                                                       | Install warning    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `scripting`        | Inject the bundled extractor, or the autofill filler (ADR-0020), into the tab when the user asks                                                                          | (with host access) |
| `storage`          | Save jobs and settings locally                                                                                                                                            | none               |
| `unlimitedStorage` | Description snapshots can exceed the 10 MB default quota over time                                                                                                        | none               |
| `contextMenus`     | "Track this job" and "Fill this application" on the page; "Open board" on the toolbar icon                                                                                | none               |
| `alarms`           | Wakes the worker every 15 minutes to check follow-up reminders and the closing digest (ADR-0015)                                                                          | none               |
| `identity`         | **Accounts builds only** (ADR-0011): Google sign-in, and connecting Gmail or Outlook read-only (ADR-0032), via `launchWebAuthFlow`. Absent from builds without a backend. | none               |

Host permissions (ADR-0033):

| Permission                                              | Why                                                                                                                                                                      | Install warning                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `activeTab`                                             | The toolbar icon opens the widget on, and reads, the tab it was clicked on, on any site                                                                                  | none                                                |
| `host_permissions` for the supported job sites          | The widget's button appears there by itself; opening it reads the posting. The list is `src/extraction/adapters/job-sites.ts`, tested against the adapters               | "Read and change your data on" those sites (a list) |
| Content script `launcher` on the same sites             | Draws the button and the panel's frame, and checks the address and the page's job data to label it. Reads nothing else and sends nothing until the panel opens           | (same as above)                                     |
| `optional_host_permissions` `https://*/*`, `http://*/*` | "Show the button on all sites" (registers the same script for every page), and capture from a pasted link (that one site, given back afterwards). Asked for in the click | none at install                                     |

Connecting a mailbox (ADR-0032) asks Google (`gmail.readonly`) or Microsoft
(`Mail.Read`, `offline_access`) for read-only access in their own consent
screens; the extension reaches their APIs under the host access above and
adds no manifest permission.

Not requested, on purpose:

- **Required access to all sites**: the strongest install warning and an
  in-depth store review every release (ADR-0033).
- **`tabs`**: not needed; the widget asks for its own tab (`tabs.getCurrent`),
  and `runtime.getContexts` finds our own board tab.
- **`favicon`**: tried and removed (see ADR-0002).

Manifest keys that aren't permissions:

| Key                        | Why                                                                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `web_accessible_resources` | `widget.html` (the widget's panel, framed in the page) and `icon/48.png` (its button). No data; lets a page detect Rolestash is installed |

| Key                                        | Why                                                                                                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `externally_connectable` (accounts builds) | Lets **only** `https://rolestash.com/board/*` message the extension, to sign the web board in from this browser's account (ADR-0017). No install warning. |

Optional permissions (requested at the moment of use):

| Permission      | Why                                                                                                   | Asked when                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `notifications` | Follow-up reminders and the closing-soon digest (Pro; ADR-0015). Optional so installs show no warning | Setting a first follow-up, or turning on closing alerts (a click) |

Capture from a pasted link runs in the board page:

- it fetches the page with `credentials: 'omit'` and parses it inertly
  with `DOMParser`, using the same pure extractor;
- for pages that need JavaScript, it falls back to a background tab
  (`tabs.create` plus `scripting`, which the host access allows);
- it needs neither an `offscreen` document nor the `tabs` permission.

## Commands

| Command             | Default shortcut | Action                     |
| ------------------- | ---------------- | -------------------------- |
| `_execute_action`   | Alt+J            | Open or close the widget   |
| `track-current-tab` | Alt+Shift+J      | Instant save, badge result |

Users can rebind them at `chrome://extensions/shortcuts`.
