# ADR-0033: The button on job sites by default, on all sites by choice

- **Status:** Accepted
- **Date:** 2026-10-06
- Supersedes ADR-0031 (required access to every page). Builds on ADR-0030.

## Context

ADR-0031 put the widget's button on every page with required access to all
sites. The Chrome Web Store flagged 0.4.6 for "Broad Host Permissions",
which means an in-depth review every release, and the install prompt read
"Read and change all your data on all websites". The owner chose a hybrid
over that cost.

## Decision

- **Required:** host access to the supported job sites
  (`src/extraction/adapters/job-sites.ts`, kept equal to the adapters by a
  test), with the `launcher` content script on them, and `activeTab`, so the
  toolbar icon opens the widget on any other tab it's clicked on.
- **Optional:** `https://*/*` and `http://*/*`. "Show the button on all sites"
  (board menu and the widget's menu) asks Chrome for it in that click; when
  granted, `platform/all-sites.ts` registers the same script for every page
  except the job sites (`scripting.registerContentScripts`, persistent) and
  stores `widget:allSites` for the script and the menus. Turning it off, or
  removing the access in Chrome, unregisters it (`permissions.onRemoved`).
- **Pasted links** ask for one site's access as before, and give it back
  only if they asked for it, so all sites or a job site keeps its access.

## Consequences

- No broad host permission at install: a list of job sites instead, and a
  shorter review. Power users get the button everywhere with one click.
- The background re-syncs the registration on install, startup and every
  permission change, so the script and the access can't drift apart.

## Alternatives considered

- **Keep ADR-0031:** in-depth review every release, and the strongest
  install warning there is.
- **activeTab only:** no button by itself anywhere.
