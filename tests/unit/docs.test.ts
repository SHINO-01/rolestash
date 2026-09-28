import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderSupportedSites } from '../../scripts/supported-sites-markdown';

describe('generated docs', () => {
  it('docs/reference/supported-sites.md is up to date (run `npm run docs:sites`)', () => {
    const committed = readFileSync(
      resolve(import.meta.dirname, '../../docs/reference/supported-sites.md'),
      'utf8',
    );
    expect(committed).toBe(renderSupportedSites());
  });
});
