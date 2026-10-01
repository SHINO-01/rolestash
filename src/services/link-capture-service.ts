import { extractJob, type ExtractionResult } from '@/extraction';
import { pickBest, type CaptureOutcome } from './capture-service';
import type { PlanProvider } from './job-service';
import type { PageLoader } from './ports';

/** Below this, the fetched HTML probably needed JavaScript: try a real tab. */
const GOOD_ENOUGH = 0.6;

/** Parses fetched HTML into an inert document (no scripts run, nothing loads). */
export type HtmlParser = (html: string) => Document;

export const domParser: HtmlParser = (html) => new DOMParser().parseFromString(html, 'text/html');

/** http(s) links only, and not pages Chrome won't let extensions read. */
export function normaliseLink(input: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  if (/(^|\.)chromewebstore\.google\.com$|^chrome\.google\.com$/.test(url.hostname))
    return undefined;
  url.hash = '';
  return url;
}

const usable = (r: ExtractionResult | undefined) =>
  r !== undefined && r.isJobPage && Boolean(r.fields.title) && r.confidence >= GOOD_ENOUGH;

/**
 * Capture from a pasted link (Pro). Fetches the page and runs the same pure
 * extractor as the toolbar button; if that comes back thin (pages rendered
 * by JavaScript), renders it in a background tab instead. The caller has
 * already been granted access to the link's site (an optional host
 * permission, asked for in the click).
 */
export class LinkCaptureService {
  constructor(
    private readonly loader: PageLoader,
    private readonly parse: HtmlParser = domParser,
    private readonly plans?: PlanProvider,
  ) {}

  async canUse(): Promise<boolean> {
    return !this.plans || (await this.plans.currentPlan()) !== 'free';
  }

  async capture(link: string): Promise<CaptureOutcome> {
    const url = normaliseLink(link);
    if (!url)
      return {
        ok: false,
        reason: 'restricted',
        message: 'Paste a full web link, starting with https://',
      };

    let fetched: ExtractionResult | undefined;
    try {
      const page = await this.loader.fetch(url.href);
      const doc = this.parse(page.html);
      // Resolve relative links against the page, not the extension.
      const base = doc.createElement('base');
      base.href = page.url;
      doc.head.prepend(base);
      fetched = extractJob(doc, page.url);
    } catch {
      fetched = undefined; // blocked, offline or not HTML: the tab may still work
    }
    if (usable(fetched) && fetched) return { ok: true, result: fetched };

    try {
      const best = pickBest([
        ...(fetched ? [fetched] : []),
        ...(await this.loader.render(url.href)),
      ]);
      if (best?.isJobPage) return { ok: true, result: best };
    } catch {
      // fall through to the message below
    }
    return fetched?.fields.title
      ? { ok: true, result: fetched }
      : {
          ok: false,
          reason: 'no-result',
          message:
            'Couldn’t find a job posting at that link. Open it and click the Rolestash icon, or fill in the details below.',
        };
  }
}
