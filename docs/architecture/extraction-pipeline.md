# Extraction pipeline

`extractJob(doc, url)` in `src/extraction/extract.ts` turns a page into an
`ExtractionResult`. It is pure, deterministic and never throws.

## 1. Resolve the site adapter

`resolveAdapter(url, doc)` (`adapters/registry.ts`):

1. **Host match**: first adapter whose `hosts` match. A string matches the
   domain and its subdomains (`seek.com.au` ⇒ `www.seek.com.au`); a RegExp is
   used for multi-TLD brands (`indeed.co.uk`, `au.indeed.com`).
2. **DOM fingerprint**: only if no host matched, the first adapter whose
   `detect(doc)` returns true. Used for white-labelled platforms on customer
   domains: Workday, SuccessFactors, Teamtailor.

No adapter is fine: the generic strategies still run.

## 2. Run the strategies

Each strategy returns a `StrategyOutput`: for every field it found, a
`{ value, confidence, strategy }`. Order matters only for tie-breaks.

| #   | Strategy  | File                      | Confidence                                                                                                             | Notes                                                                                                             |
| --- | --------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | JSON-LD   | `strategies/json-ld.ts`   | 0.95 (0.6 if several postings and none matches the URL)                                                                | Handles `@graph`, arrays, nested `mainEntity`, IRI `@type`s, broken JSON (trailing commas, control chars, CDATA). |
| 2   | Microdata | `strategies/microdata.ts` | 0.90                                                                                                                   | `itemscope itemtype=…/JobPosting`; respects nested scopes.                                                        |
| 3   | Adapter   | `strategies/adapter.ts`   | selectors 0.85 (per-adapter override), custom `extract` 0.85, external id 0.9, title pattern 0.7, company-from-URL 0.5 | Selectors support `@attr` suffix (`img.logo@alt`). Pills (salary / type / workplace) read all matches.            |
| 4   | Meta      | `strategies/meta.ts`      | 0.2–0.5                                                                                                                | "Title at Company" in `og:title`/`<title>`, first `<h1>`, `og:site_name`, main/article text.                      |

A strategy that throws is logged and skipped.

## 3. Merge per field

`mergeOutputs` (`merge.ts`) keeps, for each field, the highest-confidence
candidate (ties go to the earlier strategy). The winner's strategy and
confidence are recorded in `provenance` and later stored on the job as
`extraction.provenance` (e.g. `"title": "json-ld@0.95"`).

## 4. Post-process

Cross-field rules that no single strategy can apply:

- Drop `company` if it's really the site ("LinkedIn", "SEEK", the host, "Careers").
- Clean company names: leading "at ", Glassdoor star ratings, "… logo".
- Clean titles: Indeed's hidden "- job post" suffix.
- Infer `workplaceType` from the location text when missing ("Sydney NSW (Hybrid)").

## 5. Canonical URL and verdict

- `url` = adapter `canonicalUrl(url)` or generic `canonicalizeUrl` (strip
  tracking params, `www.`, fragments, trailing slash; sort params). This is
  what duplicate detection compares, and it resolves search views to the job
  (`linkedin.com/jobs/search?currentJobId=1` → `linkedin.com/jobs/view/1`).
- `confidence` = weighted score: title 0.4, company 0.3, location 0.15, description 0.15.
- `isJobPage` = structured data present, or an adapter found a title (≥ 0.7), or confidence ≥ 0.6.

## Normalisers (`normalize/`)

| Module           | Does                                                                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text.ts`        | `cleanText`, entity decoding, `htmlToText` / `elementToText` (paragraphs + `•` bullets, inert parsing, 60k cap)                                             |
| `salary.ts`      | Free text (`$120-140k + super`, `£45k per annum`, `12-18 Lacs P.A.`) and schema.org `MonetaryAmount`; never guesses `$` currency without an adapter default |
| `dates.ts`       | ISO / human dates and relative ones (`Posted 3d ago`, `Reposted 2 weeks ago`)                                                                               |
| `classifiers.ts` | Employment type (`FULL_TIME`, `Permanent`, `Casual/Vacation`) and workplace (`TELECOMMUTE`, `Hybrid`)                                                       |
| `url.ts`         | Canonicalisation and tracking-parameter list                                                                                                                |

## Frames

`ScriptingExtractorRunner` injects into all frames it can access and
`pickBest` prefers: job pages → higher confidence → top frame. This covers ATSs
that render the posting in a same-origin iframe (iCIMS). Cross-origin iframes
(an embedded Greenhouse board on `acme.com`) are not accessible under
`activeTab`; the user can open the posting directly.

## Why not a readability algorithm or ML?

Structured data covers most postings exactly, adapters cover the big sites
that don't publish it, and the rest is flagged "Best guess" for the user to
check in the popup. That is predictable, debuggable (provenance), fast and
private. See ADR-0003.
