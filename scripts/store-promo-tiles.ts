/**
 * Chrome Web Store promo tiles: small (440×280) and marquee (1400×560), as
 * JPEG (the store wants no alpha). Built from the brand (colours, mark,
 * fonts) plus a real capture of the widget from the production build and
 * the website's board screenshot, with fictional companies only. Copy the
 * output into rolestash-extension's store/promo/.
 *
 * Usage: npm run store:promo  (builds first)
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '..');
const EXTENSION = join(ROOT, '.output/chrome-mv3');
const OUT = join(ROOT, '.output/store-promo');

const dataUrl = (path: string, type: string) =>
  `data:${type};base64,${readFileSync(join(ROOT, path)).toString('base64')}`;
const FONTS = `
@font-face { font-family: 'Bricolage'; src: url(${dataUrl('node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2', 'font/woff2')}) format('woff2'); font-weight: 200 800; }
@font-face { font-family: 'Inter'; src: url(${dataUrl('node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', 'font/woff2')}) format('woff2'); font-weight: 100 900; }`;
const MARK = dataUrl('brand/rolestash-mark.svg', 'image/svg+xml');
const BOARD = dataUrl('site/assets/board-light-1536.webp', 'image/webp');

/** A fictional posting for the widget to read, served at a job-board address. */
const JOB_URL = 'https://boards.greenhouse.io/ironwoodgrid/jobs/4021';
const JOB_PAGE = `<!doctype html><meta charset="utf-8"><title>Platform Engineer - Ironwood Grid</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"Platform Engineer",
"hiringOrganization":{"@type":"Organization","name":"Ironwood Grid"},"employmentType":"FULL_TIME",
"jobLocation":{"@type":"Place","address":{"@type":"PostalAddress","addressLocality":"Perth","addressRegion":"WA","addressCountry":"AU"}},
"baseSalary":{"@type":"MonetaryAmount","currency":"AUD","value":{"@type":"QuantitativeValue","minValue":140000,"maxValue":160000,"unitText":"YEAR"}},
"workplaceType":"hybrid","description":"Help us build the systems that keep a renewable grid in balance. Location: Perth WA (Hybrid)."}</script>
<body style="margin:0;background:#fff"><h1 style="font:600 28px system-ui;margin:40px">Platform Engineer</h1>`;

const BASE = `${FONTS}
* { box-sizing: border-box; margin: 0; }
body { width: var(--w); height: var(--h); overflow: hidden; font-family: Inter, sans-serif;
  background: radial-gradient(120% 140% at 0% 0%, #0f7a6b 0%, #0B5D52 45%, #083f38 100%); color: #FFF7E6; }
.brand { display: flex; align-items: center; gap: 12px; font: 700 28px/1 Bricolage, sans-serif; letter-spacing: -0.02em; }
.brand img { border-radius: 22%; box-shadow: 0 6px 18px rgb(0 0 0 / .25); }
h1 { font-family: Bricolage, sans-serif; font-weight: 700; letter-spacing: -0.03em; line-height: 1.02; }
h1 em { font-style: normal; color: #F4B63F; }
.shot { border-radius: 14px; box-shadow: 0 30px 70px rgb(0 0 0 / .45), 0 0 0 1px rgb(255 255 255 / .12); display: block; }`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), 'rolestash-promo-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    args: [
      '--headless=new',
      `--disable-extensions-except=${EXTENSION}`,
      `--load-extension=${EXTENSION}`,
    ],
  });
  try {
    // 1. The widget on a job page, captured from the production build.
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await page.route(JOB_URL, (route) =>
      route.fulfill({ contentType: 'text/html', body: JOB_PAGE }),
    );
    await page.goto(JOB_URL);
    await page.waitForTimeout(2000);
    // The button sits at the right edge by default (launcher-position.ts), in a closed shadow root.
    await page.mouse.click(1280 - 12 - 30, Math.round(0.72 * 800) + 24);
    await page.waitForTimeout(1500);
    const widget = page.frames().find((f) => f.url().endsWith('/widget.html'));
    if (!widget) throw new Error('The widget did not open');
    await widget.getByText('Save job').waitFor();
    const height = await widget.evaluate(() => document.documentElement.scrollHeight);
    const shot = await page.screenshot({
      clip: {
        x: 1280 - 16 - 380,
        y: 800 - 16 - Math.min(height, 768),
        width: 380,
        height: Math.min(height, 768),
      },
    });
    const WIDGET = `data:image/png;base64,${shot.toString('base64')}`;
    await page.close();

    const render = async (name: string, width: number, height: number, html: string) => {
      const tile = await context.newPage();
      await tile.setViewportSize({ width, height });
      await tile.setContent(
        `<!doctype html><meta charset="utf-8"><style>:root{--w:${String(width)}px;--h:${String(height)}px}${BASE}</style>${html}`,
      );
      await tile.evaluate(() => document.fonts.ready);
      // JPEG: no alpha channel, as the store requires.
      await tile.screenshot({ path: join(OUT, name), type: 'jpeg', quality: 92, scale: 'css' });
      await tile.close();
      console.log(`.output/store-promo/${name}`);
    };

    // 2. Small tile: one message, legible when shrunk.
    await render(
      'small-440x280.jpg',
      440,
      280,
      `<div style="padding:30px 32px;height:100%;display:flex;flex-direction:column;justify-content:space-between">
        <div class="brand"><img src="${MARK}" width="44" height="44" alt="">Rolestash</div>
        <h1 style="font-size:40px">Save every job.<br><em>Track every reply.</em></h1>
        <p style="font-size:15px;opacity:.85;font-weight:500">The private job application tracker</p>
      </div>`,
    );

    // 3. Marquee: the promise on the left, the product on the right.
    await render(
      'marquee-1400x560.jpg',
      1400,
      560,
      `<div style="display:grid;grid-template-columns:600px 1fr;height:100%;padding:0 0 0 72px;align-items:center">
        <div style="display:flex;flex-direction:column;gap:26px">
          <div class="brand"><img src="${MARK}" width="48" height="48" alt="">Rolestash</div>
          <h1 style="font-size:58px">Save, apply and track<br><em>from any job page.</em></h1>
          <p style="font-size:21px;line-height:1.45;opacity:.9;max-width:520px">One click saves the posting, fills in the application and keeps your board up to date. No AI reads your search.</p>
        </div>
        <div style="position:relative;height:100%">
          <img class="shot" src="${BOARD}" alt="" style="position:absolute;left:10px;top:118px;width:860px;transform:rotate(-2deg)">
          <img class="shot" src="${WIDGET}" alt="" style="position:absolute;left:330px;top:150px;width:340px;border-radius:16px">
        </div>
      </div>`,
    );
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

await main();
