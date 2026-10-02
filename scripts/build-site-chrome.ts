/**
 * Stamps the landing page's header and footer onto every other page of
 * rolestash.com (site/). There's no build step, so the shared chrome is
 * copied into each file; tests/unit/site checks they stay identical.
 *
 * Usage: edit the header or footer in site/index.html, then
 *   npm run site:chrome
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SITE = resolve(import.meta.dirname, '../site');
const BLOCKS = [
  /<header class="site-header">[\s\S]*?<\/header>/,
  /<footer class="site-footer">[\s\S]*?<\/footer>/,
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Returns `page` with its header and footer replaced by the landing page's. */
export function stampChrome(page: string, landing: string): string {
  return BLOCKS.reduce((html, block) => {
    const source = block.exec(landing)?.[0];
    if (!source || !block.test(html)) throw new Error(`Missing ${block.source.slice(0, 30)}…`);
    return html.replace(block, () => source);
  }, page);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const landing = readFileSync(join(SITE, 'index.html'), 'utf8');
  // site/board/ is the web board's build output (gitignored, its own app shell).
  const pages = walk(SITE).filter(
    (f) => f.endsWith('.html') && !relative(SITE, f).startsWith('board/'),
  );
  for (const file of pages) {
    const before = readFileSync(file, 'utf8');
    const after = stampChrome(before, landing);
    if (after !== before) {
      writeFileSync(file, after);
      console.log(`stamped ${relative(SITE, file)}`);
    }
  }
}
