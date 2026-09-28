import { cleanText, elementToText } from '../normalize/text';
import type { ExtractionContext, Strategy, StrategyOutput } from '../types';
import { metaContent, put } from './shared';
import { TITLE_AT_COMPANY } from '../adapters/helpers';

/**
 * Last-resort heuristics for sites with no adapter and no structured data:
 * OpenGraph tags, the document title and the page's first <h1>. Confidence is
 * intentionally low so anything better overrides it, and the UI flags these
 * fields for the user to double-check.
 */

const SITE_SUFFIX = /\s*[|–—-]\s*[^|–—-]{2,40}$/;

export const metaStrategy: Strategy = {
  id: 'meta',
  run(ctx: ExtractionContext): StrategyOutput {
    const { doc } = ctx;
    const out: StrategyOutput = {};

    const h1 = cleanText(doc.querySelector('main h1, article h1, h1')?.textContent);
    const ogTitle = metaContent(doc, 'og:title', 'twitter:title');
    const docTitle = cleanText(doc.title);
    const siteName = metaContent(doc, 'og:site_name', 'application-name');

    // "Senior Engineer at Acme | Careers" → title + company
    for (const candidate of [ogTitle, docTitle]) {
      const groups = candidate ? TITLE_AT_COMPANY.exec(candidate)?.groups : undefined;
      if (groups?.title && groups.company) {
        put(out, 'title', cleanText(groups.title), 0.5, 'heuristic');
        put(out, 'company', cleanText(groups.company), 0.45, 'heuristic');
        break;
      }
    }

    if (h1 && h1.length <= 150)
      put(out, 'title', h1, out.title ? Math.max(out.title.confidence, 0.45) : 0.45, 'heuristic');
    if (!out.title) {
      const fallback = (ogTitle ?? docTitle).replace(SITE_SUFFIX, '');
      put(out, 'title', fallback, 0.3, 'meta');
    }

    // og:site_name is the employer on company career sites, but the board's name
    // on job boards — the pipeline discards it when it equals the site name.
    if (!out.company && siteName) put(out, 'company', siteName, 0.3, 'meta');

    // Description: the biggest <article>/<main> block, else meta description.
    const container = doc.querySelector('article, [role="main"], main');
    const body = container ? elementToText(container) : '';
    if (body.length > 200) put(out, 'description', body, 0.3, 'heuristic');
    else put(out, 'description', metaContent(doc, 'og:description', 'description'), 0.2, 'meta');

    return out;
  },
};
