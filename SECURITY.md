# Security policy

Please report vulnerabilities privately through
[GitHub private vulnerability reporting](https://github.com/SHINO-01/rolestash/security/advisories/new),
not in public issues. You should get a reply within a week.

Only the latest release published to the Chrome Web Store is supported.

Relevant design constraints: the extension makes no network requests, stores
data only in `chrome.storage.local`, never renders page HTML, and reads pages
only after a user gesture (`activeTab`). See `docs/reference/permissions.md`.
