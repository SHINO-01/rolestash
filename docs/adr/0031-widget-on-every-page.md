# ADR-0031: Show the widget's button on every web page

- **Status:** Superseded by ADR-0033 (job sites by default, all sites by choice)
- **Date:** 2026-10-06
- Amends ADR-0030 (the button was limited to a list of job sites) and
  AGENTS.md rule 3.

## Context

ADR-0030 put the floating button on about 100 job-site patterns and left
every other page to the toolbar icon. The owner decided that isn't enough
against Huntr, Teal and Simplify, whose buttons are on every page: careers
pages on company domains, white-labelled ATS sites (Workday on a customer's
domain, Oracle, SuccessFactors) and new boards are where people apply too.

## Decision

- The `launcher` content script and the host permissions cover every
  `https://` and `http://` page. Install and update show "Read and change all
  your data on all websites"; existing users approve it once.
- On each page the button only checks whether a job is open (the site
  adapter's job id in the address, or schema.org JobPosting data,
  `src/extraction/job-view.ts`), a few times after each address change and
  then not again, so idle tabs cost nothing. It reads nothing else, stores
  nothing about the page and sends nothing until the user opens the panel.
- The button is the logo on ordinary pages and says "Save job" on a job.
  It can be dragged to any height on either edge (it snaps to the nearer
  one, looks pressed while held, and remembers its place), moved with the
  arrow keys, and hidden per site.
- `activeTab` and the optional per-site access for pasted links are gone:
  the host access covers both. Rolestash's own site has no button.
- The release policy in rolestash-extension allows exactly these host
  patterns, a content script only within them and never in subframes.

## Consequences

- The strongest install warning there is, and a slower, stricter Web Store
  review. The listing and privacy policy say plainly what the access is for.
- A bug in the content script now affects every page, not just job sites:
  keep it small, inert and free of page data (AGENTS.md rule 3).
- Promises that Rolestash "reads a page only when you click" now read "reads
  a page only when you open the panel; it checks whether a job is open".

## Alternatives considered

- **The job-site list (ADR-0030):** misses company careers sites and
  white-labelled ATS domains.
- **Opt-in "show on all sites":** a smaller warning, but most people would
  never turn it on.
