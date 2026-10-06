# ADR-0030: A floating widget on job sites replaces the popup and the side panel

- **Status:** Accepted
- **Date:** 2026-10-06
- Supersedes ADR-0021 (side panel). Amends ADR-0004 (activeTab only). Amended by ADR-0031 (the button on every page), which ADR-0033 superseded: job sites by default, all sites by choice.

## Context

The owner asked for Rolestash to be a floating widget on job sites, with
the apply workflow (save, fill the application, mark it applied) in one
compact place, and for the side panel to go: it was a second surface doing
less than the popup, with its own setting and plan rules.

ADR-0021 chose the side panel because a widget on pages needs host
permissions. The owner accepted that cost (asked 2026-10-06: required
access to the supported job sites, rather than an opt-in).

## Decision

- **Where:** a content script (`src/entrypoints/launcher.content.ts`) on the
  supported job sites in `src/extraction/adapters/job-sites.ts`, which are
  also the `host_permissions`. Install and update show "Read and change your
  data on" those sites; existing users approve once after the update. Hosts
  that also run unrelated business systems (Oracle Cloud, SAP
  SuccessFactors) are left out. A unit test keeps the list and the adapters
  in step.
- **What the page gets:** a small launcher at the right edge, in a closed
  shadow root. Clicking it opens a panel: an iframe of the extension page
  `widget.html`, which does all the work with the same services as before
  (capture, duplicates, plan limits, autofill). The content script reads
  nothing from the page; it only draws the launcher, watches the URL so
  single-page sites refresh the panel, and accepts two messages from the
  iframe (its height, and "close"), checked against the iframe's window and
  the extension's origin. Nothing is sent into the iframe.
- **The toolbar icon and Alt+J** open the same widget on the current page.
  The manifest has no popup; `action.onClicked` messages the content script,
  or injects it first on any other site (allowed by `activeTab`), and opens
  the board on pages Chrome keeps extensions out of.
- **The widget's job:** a summary of the posting and **Save job** with the
  column picked; **Edit details** for the full form, which opens by itself
  when the title or company is a guess. A saved posting shows its column as
  one tap to move it (e.g. to Applied), **Open card**, and **Fill this
  application**. Report a problem, extraction details and "Hide the button
  on this site" are in its menu.
- **Removed:** the popup, the side panel, the `sidePanel` permission, the
  "Toolbar icon opens the side panel" setting (`iconOpensPanel` stays in the
  schema, unused, so older settings and backups read as before) and the
  "Open side panel" menu item.
- `widget.html` and the 48px icon are web-accessible resources, so pages can
  load them in the iframe and launcher. They hold no data.

## Consequences

- One surface for capture everywhere, and no second UI to keep in step.
- The store listing's permission justification and the privacy policy say
  what the site access is for and that pages are still read only when the
  widget opens.
- Web-accessible resources let a page detect that Rolestash is installed.
- A site's own floating buttons may sit near the launcher; it stays small
  and slides out on hover, and can be hidden per site.

## Alternatives considered

- **Opt-in site access:** no install warning and no re-approval, but most
  people would never see the widget. The owner chose required access.
- **Render the panel in the page's shadow DOM** instead of an iframe: the
  page's scripts could read what Rolestash shows, and the extension's
  storage and services would need relaying through messages.
- **Keep the popup alongside:** two ways to do one thing.
