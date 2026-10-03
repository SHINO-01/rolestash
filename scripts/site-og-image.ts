/**
 * Renders the link-preview card for rolestash.com (site/assets/og-card.jpg,
 * 1200×630) from brand assets and the light board screenshot. Output is
 * committed; rerun after changing the screenshots, the headline or the brand.
 *
 * A JPEG well under 300 KB, because WhatsApp (which builds previews on the
 * sender's phone) drops larger images, and some apps don't show WebP. Meta
 * caches images by URL: when the card changes, give it a new file name.
 *
 * Usage: npx tsx scripts/site-og-image.ts   (or npm run site:og)
 */
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const ASSETS = resolve(import.meta.dirname, '../site/assets');
const OUT = 'og-card.jpg';
const MAX_BYTES = 300_000;
const TYPES: Record<string, string> = {
  woff2: 'font/woff2',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};
/** Inlined as data URLs: a page from setContent can't read local files. */
const url = (file: string) =>
  `data:${TYPES[file.split('.').pop() ?? ''] ?? ''};base64,${readFileSync(join(ASSETS, file)).toString('base64')}`;

const html = `<!doctype html><html><head><style>
@font-face { font-family: Bricolage; src: url('${url('bricolage-latin.woff2')}'); font-weight: 200 800; }
* { box-sizing: border-box; margin: 0; }
body { width: 1200px; height: 630px; overflow: hidden; font-family: Bricolage, sans-serif;
  font-optical-sizing: auto;
  background: radial-gradient(60% 70% at 0% 0%, rgb(11 93 82 / 14%), transparent 70%),
    radial-gradient(50% 60% at 100% 10%, rgb(244 182 63 / 16%), transparent 70%), #fbfaf7;
  color: #10231f; padding: 60px 72px; position: relative; }
.logo { height: 42px; }
h1 { font-size: 76px; line-height: 0.98; letter-spacing: -0.04em; word-spacing: 0.08em;
  font-weight: 640; margin-top: 44px; max-width: 640px; }
p { margin-top: 24px; font-size: 27px; color: #4c5b57; max-width: 540px; line-height: 1.35; }
.shot { position: absolute; left: 740px; top: 128px; width: 940px; border-radius: 20px 0 0 20px;
  border: 1px solid #e7e3da; box-shadow: 0 30px 60px -20px rgb(16 35 31 / 30%); background: #fff; }
.url { position: absolute; left: 72px; bottom: 54px; font-size: 22px; font-weight: 600;
  color: #0b5d52; display: flex; align-items: center; gap: 12px; }
.url::before { content: ''; width: 22px; height: 3px; background: #f4b63f; }
</style></head><body>
<img class="logo" src="${url('logo.svg')}">
<h1>Know where every job application stands.</h1>
<p>The private job tracker for Chrome. No AI, no inbox access, no data selling.</p>
<img class="shot" src="${url('board-light-1536.webp')}">
<div class="url">rolestash.com</div>
</body></html>`;

const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(ASSETS, OUT), type: 'jpeg', quality: 86 });
await browser.close();
const bytes = statSync(join(ASSETS, OUT)).size;
if (bytes > MAX_BYTES)
  throw new Error(`${OUT} is ${String(bytes)} bytes; keep it under ${String(MAX_BYTES)}`);
console.log(`site/assets/${OUT} (${String(Math.round(bytes / 1000))} KB)`);
