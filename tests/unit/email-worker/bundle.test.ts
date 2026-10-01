import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The Email Worker bundles src/email/analyze.ts. Zod would add ~800 KiB, so
 * everything analyze.ts reaches may import the schema module only as types.
 */
const EMAIL = join(__dirname, '../../../src/email');
const WORKER_REACHABLE = [
  'analyze',
  'ats',
  'clean',
  'constants',
  'html',
  'ics',
  'intent',
  'links',
  'skeleton',
  'time',
];

describe('email worker bundle', () => {
  it.each(WORKER_REACHABLE)('%s.ts imports no zod and no DOM helpers', (name) => {
    const source = readFileSync(join(EMAIL, `${name}.ts`), 'utf8');
    expect(source).not.toMatch(/from 'zod'/);
    expect(source).not.toMatch(/^import (?!type )[^;]*from '\.\/(types|match)'/m);
    expect(source).not.toMatch(/normalize\/text'|new DOMParser|\bdocument\./);
  });
});
