/**
 * Renders the link-preview card for rolestash.com (site/assets/og-image.png,
 * 1200×630) from brand assets and the light board screenshot. Output is
 * committed; rerun after changing the screenshots or the brand.
 *
 * Usage: npx tsx scripts/site-og-image.ts   (or npm run site:og)
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const ASSETS = resolve(import.meta.dirname, '../site/assets');
const TYPES: Record<string, string> = {
  woff2: 'font/woff2',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};
/** Inlined as data URLs: a page from setContent can't read local files. */
const url = (file: string) =>
  `data:${TYPES[file.split('.').pop() ?? ''] ?? ''};base64,${readFileSync(join(ASSETS, file)).toString('base64')}`;

const html = `<!doctype html><html><head><style>
@font-face { font-family: Inter; src: url('${url('inter-latin.woff2')}'); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0; }
body { width: 1200px; height: 630px; overflow: hidden; font-family: Inter, sans-serif;
  background: radial-gradient(60% 70% at 0% 0%, rgb(11 93 82 / 16%), transparent 70%),
    radial-gradient(50% 60% at 100% 10%, rgb(244 182 63 / 22%), transparent 70%), #fbfaf7;
  color: #10231f; padding: 64px 72px; position: relative; }
.logo { height: 44px; }
h1 { font-size: 72px; line-height: 1.02; letter-spacing: -0.04em; font-weight: 780; margin-top: 40px; }
h1 em { font-style: normal; color: #0b5d52; text-decoration: underline 7px #f4b63f;
  text-underline-offset: 10px; text-decoration-skip-ink: none; }
p { margin-top: 22px; font-size: 28px; color: #4c5b57; max-width: 560px; line-height: 1.35; }
.shot { position: absolute; left: 700px; top: 150px; width: 900px; border-radius: 18px;
  border: 1px solid #e7e3da; box-shadow: 0 30px 60px -20px rgb(16 35 31 / 35%); background: #fff; }
.url { position: absolute; left: 72px; bottom: 56px; font-size: 22px; font-weight: 600; color: #0b5d52; }
</style></head><body>
<img class="logo" src="${url('logo.svg')}">
<h1>Stash every role<br>you <em>apply for</em>.</h1>
<p>A private job application tracker for Chrome. One click to save, no AI, no ads.</p>
<img class="shot" src="${url('board-light-1536.webp')}">
<div class="url">rolestash.com</div>
</body></html>`;

const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(ASSETS, 'og-image.png') });
await browser.close();
console.log('site/assets/og-image.png');
