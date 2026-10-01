/**
 * Scrubs the live page in the browser before anything is written to disk
 * (used by the snapshot scripts). Passed to page.evaluate, so it must stay
 * self-contained: no imports, no outer variables.
 *  - removes every <script> except JSON-LD, plus styles, iframes, SVGs,
 *    images' srcset, comments, event handlers and form values;
 *  - removes tracking/session query parameters from links;
 *  - drops meta tags that carry tokens (csrf, nonce, verification).
 */
export function scrubDocument(): string {
  const TRACKING =
    /^(utm_|gclid|fbclid|msclkid|mc_|_hs|ref|refId|trackingId|trk|ttk|tk|from|source|src|campaign|sid|session|token|eid|lipi|position|pageNum|origin|gh_src|lever-|t$)/i;
  const doc = document.cloneNode(true) as Document;
  doc
    .querySelectorAll(
      'script:not([type="application/ld+json"]), style, link[rel="stylesheet"], link[rel="preload"], link[rel="prefetch"], link[rel="modulepreload"], iframe, svg, noscript, template, canvas, video, audio, object, embed',
    )
    .forEach((el) => el.remove());
  doc
    .querySelectorAll(
      'meta[name*="csrf" i], meta[name*="token" i], meta[name*="verification" i], meta[name*="nonce" i], meta[http-equiv]',
    )
    .forEach((el) => el.remove());
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
  const comments: Node[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  comments.forEach((c) => c.parentNode?.removeChild(c));
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      const n = attr.name.toLowerCase();
      if (
        n.startsWith('on') ||
        n === 'style' ||
        n === 'srcset' ||
        n === 'nonce' ||
        n === 'integrity' ||
        n.startsWith('data-tracking') ||
        n.startsWith('data-impression') ||
        (n === 'value' && el.tagName !== 'OPTION')
      )
        el.removeAttribute(attr.name);
    }
    for (const key of ['href', 'src', 'action']) {
      const value = el.getAttribute(key);
      if (!value || !/^https?:|^\//.test(value)) continue;
      try {
        const u = new URL(value, location.href);
        for (const p of [...u.searchParams.keys()]) if (TRACKING.test(p)) u.searchParams.delete(p);
        el.setAttribute(key, u.href);
      } catch {
        // leave unparseable values alone
      }
    }
    if (el.tagName === 'IMG' && el.getAttribute('src')?.startsWith('data:'))
      el.setAttribute('src', '');
  });
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}
