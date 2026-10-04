import { SITE_ADAPTERS } from '../src/extraction/adapters/registry';
import type { Region, SiteAdapter } from '../src/extraction/adapters/types';

/**
 * The supported-site lists on rolestash.com (/job-sites/ and /australia/),
 * rendered from the adapter registry so the site can't drift from the code.
 * `npm run docs:sites` writes them between the `sites:*` markers, and
 * tests/unit/docs.test.ts fails if a page is stale.
 */

const REGION: Record<Region, string> = {
  global: 'worldwide',
  AU: 'Australia',
  NZ: 'New Zealand',
  US: 'United States',
  UK: 'United Kingdom',
  EU: 'Europe',
  IN: 'India',
  SEA: 'South-East Asia',
};

const KIND_TITLE: Record<SiteAdapter['kind'], string> = {
  'job-board': 'Job boards',
  aggregator: 'Job search engines',
  government: 'Government job sites',
  ats: 'Applicant tracking systems (company careers pages)',
};

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

const escape = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const byName = (a: SiteAdapter, b: SiteAdapter) => a.name.localeCompare(b.name);

function regions(adapter: SiteAdapter): string {
  // "worldwide" first, then the rest in the adapter's order, without repeats.
  const names = [...new Set(adapter.regions.map((r) => REGION[r]))];
  return names.sort((a, b) => Number(b === 'worldwide') - Number(a === 'worldwide')).join(', ');
}

function verified(adapter: SiteAdapter): string {
  if (!adapter.lastVerified) return '';
  const [y, m] = adapter.lastVerified.split('-').map(Number);
  return ` · checked on the live site, ${MONTHS[(m ?? 1) - 1] ?? ''} ${String(y)}`;
}

function item(adapter: SiteAdapter, withRegions: boolean): string {
  const detail = withRegions
    ? `${regions(adapter)}${verified(adapter)}`
    : verified(adapter).slice(3);
  return detail
    ? `<li><strong>${escape(adapter.name)}</strong> <span class="site-meta">${escape(detail)}</span></li>`
    : `<li><strong>${escape(adapter.name)}</strong></li>`;
}

/** Every adapter, grouped by kind, for /job-sites/. */
export function renderJobSitesHtml(): string {
  const out: string[] = [];
  for (const kind of Object.keys(KIND_TITLE) as SiteAdapter['kind'][]) {
    const group = SITE_ADAPTERS.filter((a) => a.kind === kind).sort(byName);
    if (group.length === 0) continue;
    out.push(`<h2>${escape(KIND_TITLE[kind])} (${String(group.length)})</h2>`);
    out.push('<ul class="site-list">', ...group.map((a) => item(a, true)), '</ul>');
  }
  return out.join('\n');
}

/** Adapters for Australian sites (and ATSs common there), for /australia/. */
export function renderAustraliaSitesHtml(): string {
  const group = SITE_ADAPTERS.filter((a) => a.regions.includes('AU')).sort(byName);
  return ['<ul class="site-list">', ...group.map((a) => item(a, false)), '</ul>'].join('\n');
}

export const SUPPORTED_SITE_COUNT = SITE_ADAPTERS.length;

/** Replaces the block between `<!-- sites:<name>:start -->` and `…:end -->`. */
export function replaceBlock(html: string, name: string, block: string): string {
  const start = `<!-- sites:${name}:start -->`;
  const end = `<!-- sites:${name}:end -->`;
  const from = html.indexOf(start);
  const to = html.indexOf(end);
  if (from === -1 || to === -1 || to < from) throw new Error(`Missing ${start} … ${end}`);
  return `${html.slice(0, from + start.length)}\n${block}\n${html.slice(to)}`;
}

/** The site pages that carry generated lists, and which list goes where. */
export const SITE_PAGES = [
  { file: 'site/job-sites/index.html', blocks: { all: renderJobSitesHtml } },
  { file: 'site/australia/index.html', blocks: { australia: renderAustraliaSitesHtml } },
] as const;

/** Fills a page's generated blocks and formats it as the repo formats HTML. */
export async function buildSitePage(
  html: string,
  page: (typeof SITE_PAGES)[number],
  path: string,
): Promise<string> {
  const { format, resolveConfig } = await import('prettier');
  let out = html;
  for (const [name, render] of Object.entries(page.blocks)) out = replaceBlock(out, name, render());
  return format(out, { parser: 'html', ...(await resolveConfig(path)) });
}
