import { SITE_ADAPTERS } from './sites';
import type { SiteAdapter } from './types';

/**
 * Adapter resolution: host match first (cheap, unambiguous), then DOM
 * fingerprints for white-labelled platforms on customer domains.
 */

export function hostMatches(hostname: string, pattern: string | RegExp): boolean {
  const host = hostname.toLowerCase();
  if (typeof pattern !== 'string') return pattern.test(host);
  const domain = pattern.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}

export function findAdapterByHost(
  url: URL,
  adapters: readonly SiteAdapter[] = SITE_ADAPTERS,
): SiteAdapter | undefined {
  return adapters.find((a) => a.hosts.some((p) => hostMatches(url.hostname, p)));
}

export function resolveAdapter(
  url: URL,
  doc: Document | undefined,
  adapters: readonly SiteAdapter[] = SITE_ADAPTERS,
): SiteAdapter | undefined {
  const byHost = findAdapterByHost(url, adapters);
  if (byHost || !doc) return byHost;
  return adapters.find((a) => {
    try {
      return a.detect?.(doc) ?? false;
    } catch {
      return false;
    }
  });
}

export { SITE_ADAPTERS };
