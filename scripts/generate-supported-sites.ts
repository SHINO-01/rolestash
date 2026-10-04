/**
 * Regenerates docs/reference/supported-sites.md and the site lists on
 * rolestash.com (/job-sites/ and /australia/) from the adapter registry, so
 * neither can drift from the code. Run: `npm run docs:sites`.
 * CI fails if any of them is stale (see tests/unit/docs.test.ts).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSitePage, SITE_PAGES } from './supported-sites-html';
import { renderSupportedSites } from './supported-sites-markdown';

const target = resolve(import.meta.dirname, '../docs/reference/supported-sites.md');
writeFileSync(target, renderSupportedSites());
console.log(`Wrote ${target}`);

for (const page of SITE_PAGES) {
  const file = resolve(import.meta.dirname, '..', page.file);
  writeFileSync(file, await buildSitePage(readFileSync(file, 'utf8'), page, file));
  console.log(`Wrote ${file}`);
}
