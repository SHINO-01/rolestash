# Adding or fixing a site adapter

Adapters live in `src/extraction/adapters/sites/`, one file per site, listed
in `sites/index.ts`. Read [the pipeline](../architecture/extraction-pipeline.md)
first: an adapter only needs to supply what structured data doesn't.

## 1. Capture a real page

1. Load a dev build, open a posting on the site, click the Rolestash icon.
2. Expand **Extraction details**. It shows the resolved adapter, and for every
   field the strategy that produced it and its confidence.
3. Click **Page HTML** to download a snapshot of the rendered DOM.
4. **Scrub personal data** from the snapshot: your name, email, avatar and
   profile links, CSRF tokens, tracking ids. Remove large irrelevant
   `<script>` bundles to keep the fixture small, but **keep**
   `<script type="application/ld+json">` blocks.

## 2. Decide whether you need an adapter at all

If the page has JSON-LD `JobPosting` and the details panel already shows
`json-ld` for title/company/location, you may only want an adapter for
**canonical URLs** (dedupe of list/search views) or the **external id**.

## 3. Write the adapter

```ts
// src/extraction/adapters/sites/acme-jobs.ts
import { canonicalFromId, currencyFromHost, pathId } from '../helpers';
import { defineAdapter } from '../types';

const id = pathId(/\/job\/(\d+)/);

export default defineAdapter({
  id: 'acme-jobs', // kebab-case, stored on every job: never rename once released
  name: 'Acme Jobs',
  kind: 'job-board', // 'job-board' | 'aggregator' | 'government' | 'ats'
  regions: ['AU'],
  homepage: 'https://www.acmejobs.example',
  hosts: ['acmejobs.example'], // matches subdomains too; RegExp for multi-TLD
  externalId: id,
  canonicalUrl: canonicalFromId(id, '/job/{id}'),
  defaultCurrency: currencyFromHost('AUD'), // what "$" means on this site
  selectors: {
    // First selector with non-empty text wins. Prefer stable hooks:
    // data-testid / data-automation / itemprop > semantic tags > class names.
    title: ['[data-testid="job-title"]', 'h1'],
    company: ['[data-testid="company"]', '.logo img@alt'], // @attr reads an attribute
    location: ['[data-testid="location"]'],
    salary: ['[data-testid="salary"]'], // parsed; ignored unless it has an amount
    employmentType: ['[data-testid="work-type"]'],
    description: ['[data-testid="description"]'], // converted to text with bullets
  },
  titlePatterns: [/^(?<title>.+?) at (?<company>.+?) \| Acme Jobs$/],
  notes: 'Anything the next maintainer should know (login walls, iframes, SPA timing).',
});
```

Helpers in `adapters/helpers.ts`: `pathId`, `queryId`, `canonicalFromId`,
`keepParams`, `companyFromSubdomain`, `companyFromPath`, `currencyFromHost`,
`TITLE_AT_COMPANY`. Use `extract(ctx)` only for logic selectors can't
express (see `linkedin.ts`); it must not throw.

For white-labelled platforms add `detect: (doc) => doc.querySelector('…') !== null`
with a cheap, specific fingerprint. It runs only when no host matched.

Register the adapter in `sites/index.ts` (keep alphabetical).

## 4. Add fixtures

```
tests/fixtures/sites/acme-jobs/job-page.html
tests/fixtures/sites/acme-jobs/job-page.expected.json
```

```json
{
  "url": "https://www.acmejobs.example/job/123?utm_source=x",
  "now": "2026-09-28T10:00:00+10:00",
  "expected": {
    "site": "acme-jobs",
    "canonicalUrl": "https://acmejobs.example/job/123",
    "title": "Software Engineer",
    "company": "Acme",
    "salary": { "min": 120000, "currency": "AUD" },
    "descriptionContains": "• TypeScript",
    "provenance": { "title": "adapter:selector" }
  }
}
```

The fixture suite picks it up automatically. Add a search/list-view case too if
the site has one (`?jobId=` style URLs). Also add host and canonical URL rows
to `tests/unit/extraction/adapters.test.ts` when they are non-obvious.

## 5. Finish

- `npm test` and `npm run docs:sites`.
- If you verified against the live site with a real (scrubbed) fixture, set
  `lastVerified: 'YYYY-MM-DD'` on the adapter.
- CHANGELOG: `### Added — Acme Jobs adapter` or `### Fixed — SEEK salary selector`.

## Fixing a broken adapter

Same loop, shorter: snapshot the page, add it as a new fixture case with the
correct expectations (it fails), fix selectors until it passes, keep the old
fixture if the old layout may still be served to some users.
