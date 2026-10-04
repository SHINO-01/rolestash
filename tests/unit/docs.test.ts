import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSitePage, SITE_PAGES } from '../../scripts/supported-sites-html';
import { renderSupportedSites } from '../../scripts/supported-sites-markdown';

describe('generated docs', () => {
  it('docs/reference/supported-sites.md is up to date (run `npm run docs:sites`)', () => {
    const committed = readFileSync(
      resolve(import.meta.dirname, '../../docs/reference/supported-sites.md'),
      'utf8',
    );
    expect(committed).toBe(renderSupportedSites());
  });

  it.each(SITE_PAGES)(
    '$file lists the supported sites (run `npm run docs:sites`)',
    async (page) => {
      const path = resolve(import.meta.dirname, '../..', page.file);
      const committed = readFileSync(path, 'utf8');
      expect(committed).toBe(await buildSitePage(committed, page, path));
    },
  );
});
