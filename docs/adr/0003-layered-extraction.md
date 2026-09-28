# ADR-0003: Layered, confidence-scored extraction

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

We must turn arbitrary job pages into structured jobs without AI, across the
top ~50 sites and unknown company career pages, and keep it maintainable as
sites change their markup.

## Decision

Run several independent strategies and merge them **per field** by confidence:

1. schema.org JSON-LD `JobPosting` (0.95) — published by most boards and ATSs for Google for Jobs
2. schema.org microdata (0.90)
3. Declarative site adapters (selectors ≈0.85, title patterns 0.7, URL-derived 0.5)
4. Meta tags and heuristics (0.2–0.5)

Record provenance for every field; flag low-confidence fields in the UI
("Best guess — please check"); always let the user edit before saving.

Adapters are **data-first** (hosts, selectors, title regexes, URL helpers) with
an `extract()` escape hatch, one file per site, registered in one list.

## Consequences

- A site that changes its markup degrades gracefully: structured data or
  heuristics usually still yield title/company.
- Fixing a site is normally a one-line selector change plus a fixture.
- Provenance makes bug reports actionable (popup → Extraction details → Copy report).
- Selectors for sites without structured data (LinkedIn signed-in, Indeed,
  SEEK) need periodic maintenance; `lastVerified` tracks it.

## Alternatives considered

- **Readability-style content scoring:** good for articles, poor at separating title/company/location.
- **Adapters only:** brittle; unknown sites get nothing.
- **First-strategy-wins:** loses good fields (e.g. JSON-LD without salary + selector with salary).
