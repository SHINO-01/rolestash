/**
 * Snapshots a live job page as a scrubbed extraction fixture
 * (docs/guides/adding-a-site-adapter.md, "Capture a real page").
 *
 * Usage:
 *   npx tsx scripts/snapshot-job-page.ts <site> <case> <url>
 *
 * Renders the page in Chromium (no extension, no cookies, a fresh profile),
 * then scrubs it before anything touches the disk:
 *  - removes every <script> except JSON-LD, plus styles, iframes, SVGs,
 *    images' srcset, comments, event handlers and form values;
 *  - removes tracking/session query parameters from links;
 *  - drops meta tags that carry tokens (csrf, nonce, verification).
 * Set HEADED=1 for boards that challenge headless browsers.
 * Writes tests/fixtures/sites/<site>/<case>.html and prints what the
 * extractor reads from it, to compare with the live page before writing
 * <case>.expected.json by hand.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { Window } from 'happy-dom';
import { extractJob } from '../src/extraction';

const [site, name, url] = process.argv.slice(2);
if (!site || !name || !url) {
  console.error('Usage: npx tsx scripts/snapshot-job-page.ts <site> <case> <url>');
  process.exit(1);
}

const ROOT = resolve(import.meta.dirname, '..');
const SETTLE_MS = 2500;

// HEADED=1 shows the window: some boards challenge headless browsers.
const browser = await chromium.launch({
  channel: 'chromium',
  headless: process.env.HEADED !== '1',
});
try {
  const context = await browser.newContext({
    locale: 'en-AU',
    timezoneId: 'Australia/Sydney',
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(SETTLE_MS);
  const finalUrl = page.url();

  const html = await page.evaluate(() => {
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
          for (const p of [...u.searchParams.keys()])
            if (TRACKING.test(p)) u.searchParams.delete(p);
          el.setAttribute(key, u.href);
        } catch {
          // leave unparseable values alone
        }
      }
      if (el.tagName === 'IMG' && el.getAttribute('src')?.startsWith('data:'))
        el.setAttribute('src', '');
    });
    return `<!doctype html>\n${doc.documentElement.outerHTML}`;
  });

  const dir = join(ROOT, 'tests/fixtures/sites', site);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.html`);
  writeFileSync(file, html);

  const window = new Window({ url: finalUrl });
  // The JSON-LD strategy decodes HTML entities with the page's DOMParser.
  Object.assign(globalThis, { DOMParser: window.DOMParser });
  window.document.write(html);
  const result = extractJob(window.document as unknown as Document, finalUrl);
  console.log(
    `Wrote ${file.replace(`${ROOT}/`, '')} (${String(Math.round(html.length / 1024))} KB)`,
  );
  console.log(`Final URL: ${finalUrl}`);
  console.log(
    JSON.stringify(
      {
        site: result.site.id,
        isJobPage: result.isJobPage,
        confidence: result.confidence,
        canonicalUrl: result.url,
        fields: { ...result.fields, description: result.fields.description?.slice(0, 160) },
        provenance: Object.fromEntries(
          Object.entries(result.provenance).map(([k, v]) => [
            k,
            `${v.strategy} ${String(v.confidence)}`,
          ]),
        ),
        warnings: result.warnings,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
