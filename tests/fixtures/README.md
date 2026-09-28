# Test fixtures

`sites/<adapter-id>/<case>.html` + `<case>.expected.json` pairs are picked up
automatically by `tests/unit/extraction/sites.test.ts`. No code change is
needed to add a regression case.

**Synthetic vs real.** Files whose first line is a `<!-- SYNTHETIC … -->`
comment were written by hand to model a site's markup; they prove the
pipeline logic, not that the live site still looks like that. Replace them
with real snapshots (popup → _Extraction details_ → _Page HTML_) and set
`lastVerified` on the adapter. **Scrub personal data** (your name, email,
profile links, tracking ids) from real snapshots before committing.

Expected-file keys: `url` (page URL to extract as), optional `now` (ISO, for
relative dates), and `expected` with any of: `site`, `canonicalUrl`, `title`,
`titleStartsWith`, `company`, `location`, `workplaceType`, `employmentTypes`,
`salary` (partial match), `postedAt`, `closesAt`, `externalId`,
`descriptionContains`, `isJobPage`, `provenance` (field → strategy).
