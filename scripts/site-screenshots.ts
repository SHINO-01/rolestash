/**
 * Regenerates the board screenshots on rolestash.com (site/assets/board-*.webp)
 * from the E2E build, seeded with fictional companies only. Output is committed.
 *
 * Usage: npm run build:e2e && npx tsx scripts/site-screenshots.ts
 *
 * Writes, for each theme (light, dark):
 *  - board-<theme>-{960,1536,2304}.webp  the full board (desktop and tablet)
 *  - board-<theme>-sm-{640,960}.webp     the first columns, larger (phones)
 * Chromium itself encodes the WebP, so no image library is needed.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '..');
const EXTENSION = join(ROOT, '.output/chrome-mv3-e2e');
const OUT = join(ROOT, 'site/assets');

interface Seed {
  title: string;
  company: string;
  stageId: string;
  location: string;
  workplaceType?: 'onsite' | 'hybrid' | 'remote';
  salary?: [number, number];
  tags?: string[];
  priority: 0 | 1 | 2 | 3;
  days: number;
}

// Fictional employers only: never show a real company's brand.
const JOBS: Seed[] = [
  {
    title: 'Frontend Engineer',
    company: 'Northwind Labs',
    stageId: 'saved',
    location: 'Sydney NSW',
    workplaceType: 'hybrid',
    salary: [150_000, 175_000],
    tags: ['react'],
    priority: 2,
    days: 0,
  },
  {
    title: 'Product Designer',
    company: 'Tidewater Studio',
    stageId: 'saved',
    location: 'Remote, Australia',
    workplaceType: 'remote',
    priority: 1,
    days: 1,
  },
  {
    title: 'Graduate Software Developer',
    company: 'Bluegum Bank',
    stageId: 'saved',
    location: 'Sydney NSW',
    workplaceType: 'onsite',
    tags: ['grad'],
    priority: 0,
    days: 0,
  },
  {
    title: 'Data Analyst',
    company: 'Kestrel Health',
    stageId: 'applied',
    location: 'Parramatta NSW',
    workplaceType: 'hybrid',
    salary: [110_000, 125_000],
    priority: 1,
    days: 2,
  },
  {
    title: 'Platform Engineer',
    company: 'Paperbark Software',
    stageId: 'applied',
    location: 'Melbourne VIC',
    workplaceType: 'hybrid',
    tags: ['go', 'k8s'],
    priority: 2,
    days: 3,
  },
  {
    title: 'UX Researcher',
    company: 'Wattle & Co',
    stageId: 'interviewing',
    location: 'Sydney NSW',
    workplaceType: 'hybrid',
    priority: 0,
    days: 9,
  },
  {
    title: 'Backend Developer',
    company: 'Summit Robotics',
    stageId: 'interviewing',
    location: 'Brisbane QLD',
    workplaceType: 'onsite',
    salary: [140_000, 160_000],
    tags: ['node'],
    priority: 3,
    days: 14,
  },
  {
    title: 'Junior Developer',
    company: 'Harbour Analytics',
    stageId: 'offer',
    location: 'Sydney NSW',
    workplaceType: 'hybrid',
    salary: [120_000, 130_000],
    priority: 3,
    days: 18,
  },
];

async function encodeWebp(page: Page, png: Buffer, width: number): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ data, width }) => {
      const bitmap = await createImageBitmap(
        new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], { type: 'image/png' }),
      );
      const canvas = new OffscreenCanvas(width, Math.round((bitmap.height * width) / bitmap.width));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.86 });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (const b of bytes) binary += String.fromCharCode(b);
      return btoa(binary);
    },
    { data: png.toString('base64'), width },
  );
  return Buffer.from(base64, 'base64');
}

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'rolestash-shots-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [
      '--headless=new',
      `--disable-extensions-except=${EXTENSION}`,
      `--load-extension=${EXTENSION}`,
    ],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const extensionId = new URL(worker.url()).host;
    await worker.evaluate(async (jobs) => {
      const DAY = 86_400_000;
      const entries = Object.fromEntries(
        jobs.map((j, i) => {
          const at = new Date(Date.now() - j.days * DAY).toISOString();
          const id = `shot${i}`;
          return [
            `job:${id}`,
            {
              id,
              title: j.title,
              company: j.company,
              location: j.location,
              workplaceType: j.workplaceType,
              employmentTypes: ['full-time'],
              salary: j.salary
                ? { min: j.salary[0], max: j.salary[1], currency: 'AUD', period: 'year' }
                : undefined,
              stageId: j.stageId,
              rank: (i + 1) * 1024,
              priority: j.priority,
              tags: j.tags ?? [],
              notes: '',
              activity: [],
              createdAt: at,
              updatedAt: at,
              appliedAt: j.stageId === 'saved' ? undefined : at,
              source: {
                url: `https://careers.example.com/jobs/${id}`,
                originalUrl: `https://careers.example.com/jobs/${id}`,
                siteId: 'generic',
                siteName: 'careers.example.com',
                capturedAt: at,
              },
            },
          ];
        }),
      );
      // The "Pin Rolestash" tip is for real installs, not the website.
      await chrome.storage.local.set({ ...entries, 'tips:pinDismissed': true });
    }, JOBS);

    const shots: { name: string; viewport: { width: number; height: number }; widths: number[] }[] =
      [
        { name: '', viewport: { width: 1536, height: 552 }, widths: [960, 1536, 2304] },
        { name: '-sm', viewport: { width: 640, height: 552 }, widths: [640, 960] },
      ];
    for (const scheme of ['light', 'dark'] as const) {
      for (const shot of shots) {
        const page = await context.newPage();
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
        await page.setViewportSize(shot.viewport);
        await page.goto(`chrome-extension://${extensionId}/board.html`);
        await page.getByText('Junior Developer').waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.mouse.move(0, 0);
        // Retina capture, then downscaled per srcset width.
        const cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          ...shot.viewport,
          deviceScaleFactor: 2,
          mobile: false,
        });
        const png = await page.screenshot({ animations: 'disabled' });
        for (const width of shot.widths) {
          const file = join(OUT, `board-${scheme}${shot.name}-${width}.webp`);
          const webp = await encodeWebp(page, png, width);
          writeFileSync(file, webp);
          console.log(`${file.replace(`${ROOT}/`, '')}  ${Math.round(webp.length / 1024)} KB`);
        }
        await page.close();
      }
    }
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

await main();
