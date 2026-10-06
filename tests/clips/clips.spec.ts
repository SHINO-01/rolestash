/**
 * The homepage feature clips (site/index.html #features), recorded from the
 * real extension and web board against the mock backend. Fictional companies
 * only. `npm run site:clips` runs this project, then
 * scripts/encode-site-clips.ts encodes the frames into site/assets.
 */
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { expect, test as base } from '../e2e/fixtures';
import { E2E_CODE } from '../e2e/mock-backend';
import { serveBoard } from '../web/serve-board';
import { analyzeEmail } from '../../src/email/analyze';
import { Recorder } from './recorder';

const PAGES = resolve(import.meta.dirname, '../fixtures/clips');
const EXTENSION = resolve(import.meta.dirname, '../../.output/chrome-mv3-e2e');
const DAY = 86_400_000;

/**
 * Desktop clips are 16:10, small enough that the UI reads at the size the
 * homepage shows them, and captured at 2× for sharp text.
 */
const VIEWPORT = { width: 880, height: 550 };
const BOARD_VIEWPORT = { width: 1000, height: 625 };

/**
 * Headless screencasts come out in CSS pixels whenever Playwright emulates the
 * viewport, so the window is sized by Chrome itself (`viewport: null`) at 2×.
 * `--window-size` includes the hidden browser UI, which is this tall.
 */
const WINDOW_UI = 87;
const windowArgs = (size: { width: number; height: number }) => [
  '--headless=new',
  '--hide-scrollbars',
  '--force-device-scale-factor=2',
  `--window-size=${String(size.width)},${String(size.height + WINDOW_UI)}`,
];

/** Fails early if the window isn't the size the clip was framed for. */
async function checkSize(page: Page, size: { width: number; height: number }) {
  const actual = await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
  expect(actual).toEqual([size.width, size.height, 2]);
}

const test = base.extend<{
  windowSize: { width: number; height: number };
  pages: { url: (path: string) => string };
}>({
  windowSize: [VIEWPORT, { option: true }],
  context: async ({ windowSize }, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: true,
      channel: 'chromium',
      viewport: null,
      args: [
        ...windowArgs(windowSize),
        `--disable-extensions-except=${EXTENSION}`,
        `--load-extension=${EXTENSION}`,
      ],
    });
    await use(context);
    await context.close();
  },
  // eslint-disable-next-line no-empty-pattern
  pages: async ({}, use) => {
    const types: Record<string, string> = { '.html': 'text/html', '.css': 'text/css' };
    const server: Server = createServer((req, res) => {
      const path = normalize(join(PAGES, (req.url ?? '/').split('?')[0] ?? '/'));
      if (!path.startsWith(PAGES)) return void res.writeHead(403).end();
      readFile(path)
        .then((body) =>
          res
            .writeHead(200, {
              'content-type': `${types[extname(path)] ?? 'text/plain'}; charset=utf-8`,
            })
            .end(body),
        )
        .catch(() => res.writeHead(404).end());
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    await use({ url: (path) => `http://127.0.0.1:${String(port)}/${path}` });
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  },
});

test.describe.configure({ timeout: 120_000 });

const PRO = {
  status: 'active',
  tier: 'advanced',
  trial_ends_at: null,
  current_period_end: new Date(Date.now() + 200 * DAY).toISOString(),
  provider_customer_id: null,
};

/** Signed in on Pro, with the first-run tips out of the way. */
async function seedPro(worker: Worker, extra: Record<string, unknown> = {}) {
  await worker.evaluate(
    async ({ end, extra }) => {
      await chrome.storage.local.set({
        'account:session': {
          accessToken: 'e2e-access',
          refreshToken: 'e2e-refresh',
          expiresAt: Date.now() + 3_600_000,
          user: { id: 'e2e-user', email: 'sam@example.com' },
        },
        'account:entitlement': {
          status: 'active',
          tier: 'advanced',
          currentPeriodEnd: end,
          hasBillingAccount: true,
          checkedAt: new Date().toISOString(),
        },
        'tips:pinDismissed': true,
        ...extra,
      });
    },
    { end: PRO.current_period_end, extra },
  );
}

interface Seed {
  id: string;
  title: string;
  company: string;
  stageId: string;
  location: string;
  workplaceType?: 'onsite' | 'hybrid' | 'remote';
  salary?: [number, number];
  tags?: string[];
  priority: 0 | 1 | 2 | 3;
  days: number;
  closesInDays?: number;
  followUpInDays?: number;
  url?: string;
}

// Fictional employers only, the same as the site's board screenshots.
const BOARD: Seed[] = [
  {
    id: 'nw',
    title: 'Frontend Engineer',
    company: 'Northwind Labs',
    stageId: 'saved',
    location: 'Sydney NSW',
    workplaceType: 'hybrid',
    salary: [150_000, 175_000],
    tags: ['react'],
    priority: 2,
    days: 0,
    closesInDays: 8,
  },
  {
    id: 'tw',
    title: 'Product Designer',
    company: 'Tidewater Studio',
    stageId: 'saved',
    location: 'Remote, Australia',
    workplaceType: 'remote',
    priority: 1,
    days: 1,
    closesInDays: 2,
  },
  {
    id: 'bg',
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
    id: 'kh',
    title: 'Data Analyst',
    company: 'Kestrel Health',
    stageId: 'applied',
    location: 'Parramatta NSW',
    workplaceType: 'hybrid',
    salary: [110_000, 125_000],
    priority: 1,
    days: 2,
    url: 'https://careers.kestrelhealth.example/jobs/data-analyst',
  },
  {
    id: 'pb',
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
    id: 'wc',
    title: 'UX Researcher',
    company: 'Wattle & Co',
    stageId: 'screening',
    location: 'Sydney NSW',
    workplaceType: 'hybrid',
    priority: 0,
    days: 9,
  },
  {
    id: 'sr',
    title: 'Backend Developer',
    company: 'Summit Robotics',
    stageId: 'interviewing',
    location: 'Brisbane QLD',
    workplaceType: 'onsite',
    salary: [140_000, 160_000],
    tags: ['node'],
    priority: 3,
    days: 14,
    followUpInDays: 0,
  },
  {
    id: 'ha',
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

function toJob(j: Seed, i: number) {
  const at = new Date(Date.now() - j.days * DAY).toISOString();
  const url = j.url ?? `https://careers.example.com/jobs/${j.id}`;
  return {
    id: j.id,
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
    closesAt:
      j.closesInDays === undefined
        ? undefined
        : new Date(Date.now() + j.closesInDays * DAY).toISOString().slice(0, 10),
    followUpAt:
      j.followUpInDays === undefined
        ? undefined
        : new Date(Date.now() + j.followUpInDays * DAY - 3_600_000).toISOString(),
    source: {
      url,
      originalUrl: url,
      siteId: 'generic',
      siteName: new URL(url).host,
      capturedAt: at,
    },
  };
}

async function seedBoard(worker: Worker, jobs: Seed[]) {
  await worker.evaluate(
    async (entries) => {
      await chrome.storage.local.set(entries);
    },
    Object.fromEntries(jobs.map((j, i) => [`job:${j.id}`, toJob(j, i)])),
  );
}

/** The panel grows upwards from the bottom of the window: wait until it stops. */
async function settled(page: Page) {
  const frame = page.locator('iframe[title="Rolestash"]');
  let last = -1;
  await expect
    .poll(async () => {
      const box = await frame.boundingBox();
      const key = (box?.y ?? -1) + (box?.height ?? 0) * 1000;
      const done = key === last;
      last = key;
      return done;
    })
    .toBe(true);
}

async function openBoard(context: BrowserContext, extensionId: string) {
  const page = await context.newPage();
  await checkSize(page, BOARD_VIEWPORT);
  await page.goto(`chrome-extension://${extensionId}/board.html`);
  await page.getByText('Junior Developer').waitFor();
  await page.evaluate(() => document.fonts.ready);
  return page;
}

const PROFILE = {
  firstName: 'Sam',
  lastName: 'Taylor',
  email: 'sam.taylor@example.com',
  phone: '0412 345 678',
  city: 'Sydney',
  region: 'NSW',
  country: 'Australia',
  linkedin: 'https://linkedin.com/in/samtaylor',
  currentTitle: 'Junior Data Analyst',
  needsSponsorship: 'no',
  answers: [
    {
      question: 'Why do you want to work here?',
      answer: 'I want my analysis to improve patient care, and your team does exactly that.',
    },
  ],
};

test('save: the button on a job page saves it', async ({ context, worker, pages }) => {
  await seedPro(worker, { profile: PROFILE });
  const page = await context.newPage();
  await checkSize(page, VIEWPORT);
  await page.goto(pages.url('job.html'));
  const launcher = page.getByRole('button', { name: 'Open Rolestash' });
  await expect(launcher.getByText('Save job')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  const rec = await Recorder.start(page, 'save', { x: 560, y: 420 });
  await rec.hold(700);
  await rec.click(launcher, 900);
  const widget = page.frameLocator('iframe[title="Rolestash"]');
  await expect(widget.getByText('Frontend Engineer')).toBeVisible();
  await settled(page);
  await rec.hold(1300);
  await rec.click(widget.getByRole('button', { name: 'Save job' }), 800);
  await expect(widget.getByRole('status')).toHaveText('Saved · Saved');
  await settled(page);
  await rec.hold(1800);
  await rec.stop();
});

test('autofill: the panel fills the application and marks it applied', async ({
  context,
  worker,
  backend,
  pages,
}) => {
  backend.entitlement = PRO;
  await seedPro(worker, { profile: PROFILE });
  const page = await context.newPage();
  await checkSize(page, VIEWPORT);
  await page.goto(pages.url('apply.html'));
  const launcher = page.getByRole('button', { name: 'Open Rolestash' });
  await expect(launcher).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  const rec = await Recorder.start(page, 'autofill', { x: 500, y: 440 });
  await rec.hold(600);
  await rec.click(launcher, 900);
  const widget = page.frameLocator('iframe[title="Rolestash"]');
  const fill = widget.getByRole('button', { name: 'Fill this application' });
  await expect(fill).toBeVisible();
  await settled(page);
  await rec.hold(900);
  await rec.click(fill, 800);
  await expect(page.locator('#first_name')).toHaveValue('Sam');
  await settled(page);
  await rec.hold(1400);
  await rec.click(widget.getByRole('radio', { name: 'Applied' }), 700);
  await rec.hold(300);
  await rec.click(widget.getByRole('button', { name: 'Save job' }), 600);
  await expect(widget.getByText('Saved · Applied')).toBeVisible();
  await settled(page);
  await rec.hold(1800);
  await rec.stop();
});

test.describe('on the board', () => {
  test.use({ windowSize: BOARD_VIEWPORT });

  test('board: drag a card when you hear back', async ({ context, worker, extensionId }) => {
    await seedPro(worker);
    await seedBoard(worker, BOARD);
    const page = await openBoard(context, extensionId);
    const card = page.getByRole('button', { name: /Platform Engineer/ });
    const target = page.getByRole('region', { name: 'Screening column' });

    const rec = await Recorder.start(page, 'board', { x: 700, y: 520 });
    await rec.hold(900);
    const from = await rec.centre(card);
    await rec.moveTo(from.x, from.y, 800);
    await rec.hold(200);
    await rec.press(true);
    await page.mouse.down();
    await rec.moveTo(from.x + 14, from.y + 10, 150);
    const to = await target.boundingBox();
    if (!to) throw new Error('no target');
    await rec.moveTo(to.x + to.width / 2, to.y + 150, 1100);
    await rec.hold(150);
    await page.mouse.up();
    await rec.press(false);
    await expect(target.getByText('Platform Engineer')).toBeVisible();
    await rec.hold(900);
    await rec.click(target.getByRole('button', { name: /Platform Engineer/ }), 600);
    await expect(page.getByRole('dialog', { name: 'Platform Engineer details' })).toBeVisible();
    await rec.hold(2200);
    await rec.stop();
  });

  test('email: a job email moves the card by itself', async ({
    context,
    worker,
    extensionId,
    backend,
  }) => {
    backend.entitlement = PRO;
    await seedPro(worker);
    await seedBoard(worker, BOARD);
    const page = await openBoard(context, extensionId);
    const posting = BOARD.find((j) => j.id === 'kh')!.url!;
    // Let the board's first check find nothing, so the move happens on camera.
    await page.waitForTimeout(1500);
    // Scroll one column along, so Applied to Offer are all in view.
    await page.evaluate(() => {
      const saved = document.querySelector('[aria-label="Saved column"]');
      let el = saved?.parentElement ?? null;
      while (el && el.scrollWidth <= el.clientWidth) el = el.parentElement;
      if (el && saved) el.scrollLeft = (saved as HTMLElement).offsetWidth + 12;
    });
    await page.waitForTimeout(300);

    const rec = await Recorder.start(page, 'email', { x: 900, y: 560 });
    await rec.hold(900);
    // A mail notification, as the email arrives in the user's inbox.
    await page.evaluate(() => {
      const el = document.createElement('div');
      el.setAttribute('popover', 'manual');
      el.innerHTML =
        '<div style="display:flex;gap:12px;align-items:center"><div style="width:38px;height:38px;border-radius:10px;background:#0f8a6b;color:#fff;display:grid;place-items:center;font-weight:700">K</div><div><div style="font-weight:650">Kestrel Health</div><div style="color:#4c5b57">Interview invitation: Data Analyst</div></div></div>';
      Object.assign(el.style, {
        position: 'fixed',
        inset: 'auto',
        right: '24px',
        top: '24px',
        margin: '0',
        padding: '14px 18px',
        border: '1px solid rgb(16 35 31 / 10%)',
        borderRadius: '14px',
        background: '#fff',
        color: '#10231f',
        font: '15px/1.35 system-ui, sans-serif',
        boxShadow: '0 12px 32px rgb(16 35 31 / 18%)',
        transform: 'translateY(-130%)',
        transition: 'transform 420ms cubic-bezier(.2,.9,.3,1.2)',
      });
      el.id = '__clip-mail';
      document.documentElement.append(el);
      el.showPopover();
      requestAnimationFrame(() => requestAnimationFrame(() => (el.style.transform = 'none')));
    });
    await rec.hold(1300);
    backend.emailEvents = [
      {
        id: 1,
        event: analyzeEmail({
          from: 'Priya Shah <priya@kestrelhealth.example>',
          subject: 'Interview invitation - Data Analyst',
          date: new Date().toISOString(),
          html: `<p>We would like to invite you to a video interview on Thursday 16 October 2031 at 10am AEDT.</p><p><a href="https://us02web.zoom.us/j/81234567890">Join Zoom</a> <a href="${posting}">The role</a></p>`,
        }),
      },
    ];
    // The board checks for updates when it regains focus.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const interviewing = page.getByRole('region', { name: 'Interviewing column' });
    await expect(interviewing.getByText('Data Analyst')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => {
      const el = document.getElementById('__clip-mail');
      if (el) el.style.transform = 'translateY(-130%)';
    });
    await rec.hold(1200);
    await rec.click(interviewing.getByRole('button', { name: /Data Analyst/ }), 700);
    await expect(page.getByRole('dialog', { name: 'Data Analyst details' })).toBeVisible();
    await rec.hold(2400);
    await rec.stop();
  });
});

test('phone: the web board, in step with the extension', async ({ backend }) => {
  backend.entitlement = { ...PRO, provider_customer_id: 'ctm_1' };
  for (const [i, j] of BOARD.entries()) {
    const data = toJob(j, i);
    backend.synced.set(j.id, {
      data,
      deleted: false,
      updated_at: data.updatedAt,
      revision: ++backend.revision,
    });
  }
  const board = await serveBoard();
  const phone = { width: 390, height: 844 };
  // Chrome won't open a window narrower than 500px: size the page inside a 2× window instead.
  const browser = await chromium.launch({
    channel: 'chromium',
    args: windowArgs({ width: 500, height: phone.height }),
  });
  try {
    const context = await browser.newContext({ viewport: null });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      ...phone,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await page.goto(`${board.origin}/board/`);
    await page.getByLabel('Email', { exact: true }).fill('sam@example.com');
    await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
    await page.getByLabel(/Code sent to/).fill(E2E_CODE);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await checkSize(page, phone);
    const followUps = page.getByRole('region', { name: 'Follow-ups' });
    await expect(followUps.getByText('Backend Developer')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    const rec = await Recorder.start(page, 'phone', { x: 300, y: 700 }, { touch: true });
    await rec.hold(900);
    await rec.click(followUps.getByText('Backend Developer'), 700);
    const sheet = page.getByRole('dialog', { name: 'Backend Developer details' });
    await expect(sheet).toBeVisible();
    await rec.hold(900);
    const notes = sheet.getByLabel('Notes');
    await rec.click(notes, 600);
    await notes.pressSequentially('Panel interview on Thursday', { delay: 45 });
    await rec.hold(700);
    await rec.click(sheet.getByRole('button', { name: 'Close' }), 600);
    // The "Notes saved" toast sits over the tab bar for a moment.
    await rec.hold(600);
    await rec.skip(() => expect(page.getByText('Notes saved')).toBeHidden({ timeout: 10_000 }));
    await rec.click(page.getByRole('button', { name: 'Board' }), 700);
    await rec.hold(500);
    await rec.click(page.getByRole('tab', { name: /Interviewing/ }), 700);
    await rec.hold(1800);
    await rec.stop();
    await context.close();
  } finally {
    await browser.close();
    await board.close();
  }
});
