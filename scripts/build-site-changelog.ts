/**
 * Renders CHANGELOG.md into rolestash.com/changelog/ (site/changelog/index.html),
 * between the changelog markers. CHANGELOG.md stays the one source: the
 * release script reruns this, and a site test fails if the page is stale.
 *
 * Usage: npx tsx scripts/build-site-changelog.ts   (or npm run site:changelog)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import { format, resolveConfig } from 'prettier';

const ROOT = resolve(import.meta.dirname, '..');
const PAGE = resolve(ROOT, 'site/changelog/index.html');
const START = '<!-- changelog:start -->';
const END = '<!-- changelog:end -->';
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const longDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${String(d)} ${MONTHS[(m ?? 1) - 1] ?? ''} ${String(y)}`;
};

/** The changelog as public HTML: user-facing headings, no internal ADR references. */
export function renderChangelog(markdown: string): string {
  const body = markdown
    .slice(markdown.indexOf('\n## '))
    .replace(/ \(ADR-\d{4}[^)]*\)/g, '')
    .replace(
      /^## \[Unreleased\]\s*$/m,
      '## Next update\n\nIn testing; arrives with the next release.',
    )
    .replace(
      /^## \[(\d+\.\d+\.\d+)\] — (\d{4}-\d{2}-\d{2})\s*$/gm,
      (_, version: string, date: string) =>
        `## Version ${version} {#v${version.replaceAll('.', '-')}}\n\nReleased ${longDate(date)}.`,
    );
  const html = marked.parse(body, { async: false, gfm: true });
  // marked keeps "{#id}" as text; turn it into the heading's id.
  return html
    .replace(/<h2>([^<]*?) \{#([a-z0-9-]+)\}<\/h2>/g, '<h2 id="$2">$1</h2>')
    .replace(/<h2>Next update<\/h2>/, '<h2 id="next">Next update</h2>')
    .trim();
}

/** Replaces the rendered block in the page; throws if the markers are missing. */
export function withChangelog(page: string, html: string): string {
  const a = page.indexOf(START);
  const b = page.indexOf(END);
  if (a < 0 || b < a) throw new Error('site/changelog/index.html is missing the changelog markers');
  return `${page.slice(0, a + START.length)}\n${html}\n${page.slice(b)}`;
}

/** Rewrites the page from CHANGELOG.md, formatted as the repo formats HTML. */
export async function buildChangelogPage(): Promise<void> {
  const markdown = readFileSync(resolve(ROOT, 'CHANGELOG.md'), 'utf8');
  const page = withChangelog(readFileSync(PAGE, 'utf8'), renderChangelog(markdown));
  writeFileSync(PAGE, await format(page, { parser: 'html', ...(await resolveConfig(PAGE)) }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildChangelogPage();
  console.log('site/changelog/index.html');
}
