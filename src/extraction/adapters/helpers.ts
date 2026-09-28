import { buildUrl } from '../normalize/url';
import { slugToName } from '../normalize/text';

/**
 * Small, composable building blocks for adapters. Prefer these over bespoke
 * `extract` functions — they are unit-tested once and reused everywhere.
 */

/** Company from the first subdomain label: `acme.bamboohr.com` → "Acme". */
export function companyFromSubdomain(
  url: URL,
  ignore: string[] = ['www', 'jobs', 'careers', 'apply'],
): string | undefined {
  const label = url.hostname.split('.')[0];
  if (!label || ignore.includes(label.toLowerCase())) return undefined;
  return slugToName(label.replace(/^careers?-/i, ''));
}

/** Company from a path segment: `jobs.lever.co/acme/…` → "Acme" (index 0). */
export function companyFromPath(url: URL, index = 0): string | undefined {
  const segment = url.pathname.split('/').filter(Boolean)[index];
  return segment ? slugToName(segment) : undefined;
}

/** Returns the first capture group of `re` in `url.pathname`. */
export function pathId(re: RegExp): (url: URL) => string | undefined {
  return (url) => re.exec(url.pathname)?.[1];
}

/** Returns a query parameter value. */
export function queryId(...names: string[]): (url: URL) => string | undefined {
  return (url) => {
    for (const name of names) {
      const value = url.searchParams.get(name);
      if (value) return value;
    }
    return undefined;
  };
}

/**
 * Canonical URL builder: if `id(url)` yields a value, rebuild the URL from a
 * template like `/jobs/view/{id}` on `host` (defaults to the current host).
 */
export function canonicalFromId(
  id: (url: URL) => string | undefined,
  template: string,
  host?: string,
): (url: URL) => string | undefined {
  return (url) => {
    const value = id(url);
    if (!value) return undefined;
    return buildUrl(host ?? url.hostname, template.replace('{id}', encodeURIComponent(value)));
  };
}

/** Keeps only the listed query params (plus path) — for sites where the id lives in the query. */
export function keepParams(...names: string[]): (url: URL) => string | undefined {
  return (url) => {
    const params: Record<string, string> = {};
    for (const name of names) {
      const v = url.searchParams.get(name);
      if (v) params[name] = v;
    }
    return buildUrl(url.hostname, url.pathname, params);
  };
}

const TLD_CURRENCY: [RegExp, string][] = [
  [/\.au$/, 'AUD'],
  [/\.nz$/, 'NZD'],
  [/\.uk$/, 'GBP'],
  [/\.ca$/, 'CAD'],
  [/\.in$/, 'INR'],
  [/\.sg$/, 'SGD'],
  [/\.my$/, 'MYR'],
  [/\.ph$/, 'PHP'],
  [/\.id$/, 'IDR'],
  [/\.hk$/, 'HKD'],
  [/\.th$/, 'THB'],
  [/\.(de|at|fr|nl|be|es|it|ie|fi|pt)$/, 'EUR'],
];
const SUBDOMAIN_CURRENCY: Record<string, string> = {
  au: 'AUD',
  nz: 'NZD',
  uk: 'GBP',
  ca: 'CAD',
  in: 'INR',
  sg: 'SGD',
  my: 'MYR',
  ph: 'PHP',
  id: 'IDR',
  hk: 'HKD',
  th: 'THB',
  us: 'USD',
};

/**
 * Infers the local currency from the TLD (`seek.co.nz` → NZD) or a country
 * subdomain (`au.indeed.com` → AUD), falling back to `fallback`.
 */
export function currencyFromHost(fallback?: string): (url: URL) => string | undefined {
  return (url) => {
    const host = url.hostname.toLowerCase();
    const sub = host.split('.')[0] ?? '';
    return SUBDOMAIN_CURRENCY[sub] ?? TLD_CURRENCY.find(([re]) => re.test(host))?.[1] ?? fallback;
  };
}

/** Standard "Title at Company" / "Title - Company | Site" title patterns. */
export const TITLE_AT_COMPANY =
  /^(?<title>.+?)\s+(?:at|@)\s+(?<company>[^|–—-]+?)(?:\s*[|–—-].*)?$/i;
