/**
 * Regenerates docs/reference/supported-sites.md from the adapter registry so
 * the docs can never drift from the code. Run: `npm run docs:sites`.
 * CI fails if the committed file is stale (see tests/unit/docs.test.ts).
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderSupportedSites } from './supported-sites-markdown';

const target = resolve(import.meta.dirname, '../docs/reference/supported-sites.md');
writeFileSync(target, renderSupportedSites());
console.log(`Wrote ${target}`);
