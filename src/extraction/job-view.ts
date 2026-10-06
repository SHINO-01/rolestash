import { findAdapterByHost } from './adapters/registry';

/**
 * Is a single job open on this page? Cheap enough to ask every second on a
 * single-page site: the site's own job id in the URL (LinkedIn's
 * `currentJobId`, SEEK's `jobId`, a Greenhouse `/jobs/123`), else a
 * schema.org JobPosting on the page. The widget's button says "Save job"
 * only then (ADR-0030); on a feed or a search list it stays a plain logo.
 */
export function looksLikeJobView(url: URL, doc: Document): boolean {
  try {
    if (findAdapterByHost(url)?.externalId?.(url)) return true;
  } catch {
    // A broken adapter rule is not a job.
  }
  if (doc.querySelector('[itemtype*="schema.org/JobPosting" i]')) return true;
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]'))
    if (/"@type"\s*:\s*(?:\[[^\]]*)?"JobPosting"/.test(script.textContent)) return true;
  return false;
}
