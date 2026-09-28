/**
 * URL canonicalisation for duplicate detection. Adapters can override this
 * with site-specific rules (e.g. LinkedIn search URL → /jobs/view/{id}).
 */

const TRACKING_PARAMS: RegExp[] = [
  /^utm_/i,
  /^(gclid|gbraid|wbraid|dclid|fbclid|msclkid|yclid|twclid|igshid|mc_cid|mc_eid|mkt_tok)$/i,
  /^_hs(enc|mi)$/i,
  /^_ga$/i,
  /^(trk|trkinfo|trackingid|refid|lipi|ebp|originalsubdomain|recommendedflavor)$/i,
  /^(ref|referrer|referer|source|src_type|sourcetype|campaign|medium)$/i,
  /^(gh_src|lever-source|lever-origin|lever-via)$/i,
  /^(in_iframe)$/i,
];

export function isTrackingParam(name: string): boolean {
  return TRACKING_PARAMS.some((re) => re.test(name));
}

export function tryParseUrl(href: string, base?: string): URL | undefined {
  try {
    return new URL(href, base);
  } catch {
    return undefined;
  }
}

/**
 * Generic canonical form:
 *  - https, lower-case host without "www."
 *  - tracking params removed, remaining params sorted
 *  - fragment dropped unless it is a hash-route ("#/job/123")
 *  - trailing slash removed (except root)
 */
export function canonicalizeUrl(href: string): string {
  const url = tryParseUrl(href);
  if (!url || !/^https?:$/.test(url.protocol)) return href;

  url.protocol = 'https:';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.port = '';

  const kept = [...url.searchParams.entries()].filter(([name]) => !isTrackingParam(name));
  kept.sort(([a], [b]) => a.localeCompare(b));
  url.search = '';
  for (const [name, value] of kept) url.searchParams.append(name, value);

  if (!/^#!?\//.test(url.hash)) url.hash = '';
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');

  return url.toString();
}

/** Builds a canonical URL from parts, e.g. `buildUrl('linkedin.com', '/jobs/view/123')`. */
export function buildUrl(host: string, path: string, params?: Record<string, string>): string {
  const url = new URL(`https://${host}${path}`);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return canonicalizeUrl(url.toString());
}

/** Hostname without "www." for display and matching. */
export function bareHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, '');
}
