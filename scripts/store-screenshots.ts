/**
 * Chrome Web Store screenshots (1280×800 PNG) from the production build,
 * seeded with fictional companies and people only. Copy the output into
 * rolestash-extension's store/screenshots/.
 *
 * Usage: npm run store:screenshots  (builds first)
 *
 * The production build has no backend, so nothing is plan-limited and no
 * sign-in UI shows: the shots show the features, not an account.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '..');
const EXTENSION = join(ROOT, '.output/chrome-mv3');
const OUT = join(ROOT, '.output/store-screenshots');
const VIEWPORT = { width: 1280, height: 800 };

interface Seed {
  title: string;
  company: string;
  stageId: string;
  location: string;
  salary?: [number, number];
  tags?: string[];
  priority: 0 | 1 | 2 | 3;
  /** Days since it was saved (and applied, past Saved). */
  days: number;
  /** Columns it moved through after Applied, in order. */
  path?: string[];
}

// Fictional employers only: never show a real company's brand.
const JOBS: Seed[] = [
  {
    title: 'Frontend Engineer',
    company: 'Northwind Labs',
    stageId: 'saved',
    location: 'Sydney NSW',
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
    priority: 1,
    days: 1,
  },
  {
    title: 'Graduate Software Developer',
    company: 'Bluegum Bank',
    stageId: 'saved',
    location: 'Sydney NSW',
    priority: 0,
    days: 2,
  },
  {
    title: 'Data Analyst',
    company: 'Quokka Health',
    stageId: 'applied',
    location: 'Melbourne VIC',
    salary: [95_000, 110_000],
    priority: 2,
    days: 4,
  },
  {
    title: 'Junior Developer',
    company: 'Harbourline Logistics',
    stageId: 'applied',
    location: 'Brisbane QLD',
    priority: 1,
    days: 9,
  },
  {
    title: 'UX Researcher',
    company: 'Wattle & Co',
    stageId: 'applied',
    location: 'Adelaide SA',
    priority: 0,
    days: 30,
  },
  {
    title: 'Backend Developer',
    company: 'Summit Robotics',
    stageId: 'interviewing',
    location: 'Sydney NSW',
    salary: [130_000, 150_000],
    tags: ['go'],
    priority: 3,
    days: 21,
    path: ['screening', 'interviewing'],
  },
  {
    title: 'Platform Engineer',
    company: 'Coral Cloud',
    stageId: 'screening',
    location: 'Remote, Australia',
    priority: 2,
    days: 14,
    path: ['screening'],
  },
  {
    title: 'Software Engineer',
    company: 'Kestrel Energy',
    stageId: 'offer',
    location: 'Perth WA',
    salary: [140_000, 160_000],
    priority: 3,
    days: 40,
    path: ['screening', 'interviewing', 'offer'],
  },
  {
    title: 'Web Developer',
    company: 'Lantern Media',
    stageId: 'rejected',
    location: 'Sydney NSW',
    priority: 0,
    days: 35,
    path: ['rejected'],
  },
  {
    title: 'QA Engineer',
    company: 'Ironbark Systems',
    stageId: 'rejected',
    location: 'Canberra ACT',
    priority: 0,
    days: 33,
    path: ['screening', 'rejected'],
  },
  {
    title: 'Mobile Developer',
    company: 'Saltbush Apps',
    stageId: 'applied',
    location: 'Hobart TAS',
    priority: 1,
    days: 45,
  },
  {
    title: 'Analytics Engineer',
    company: 'Riverbend Insurance',
    stageId: 'rejected',
    location: 'Melbourne VIC',
    priority: 0,
    days: 50,
    path: ['rejected'],
  },
  {
    title: 'Solutions Engineer',
    company: 'Granite Peak',
    stageId: 'interviewing',
    location: 'Sydney NSW',
    priority: 2,
    days: 18,
    path: ['interviewing'],
  },
];

/** A fictional careers page to show beside the side panel. */
const CAREERS_PAGE = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;font:15px/1.5 system-ui,sans-serif;color:#1f2937;background:#f8fafc}
header{background:#14532d;color:#fff;padding:18px 40px;font-weight:700;font-size:18px}
main{padding:32px 40px;max-width:720px}h1{margin:0 0 4px;font-size:28px}
.meta{color:#6b7280;margin-bottom:20px}label{display:block;font-weight:600;margin:14px 0 4px}
input{width:100%;padding:9px 10px;border:1px solid #cbd5e1;border-radius:8px;font:inherit;box-sizing:border-box}
button{margin-top:20px;background:#14532d;color:#fff;border:0;border-radius:8px;padding:10px 18px;font:inherit}
</style><header>Kestrel Energy · Careers</header><main><h1>Software Engineer</h1>
<div class="meta">Perth WA · Full-time · A$140K – 160K</div>
<p>Help us build the systems that keep a renewable grid in balance.</p>
<label>First name</label><input value="Sam"><label>Last name</label><input value="Taylor">
<label>Email</label><input value="sam.taylor@example.com"><label>Phone</label><input value="+61 400 123 456">
<label>LinkedIn</label><input value="https://linkedin.com/in/sam-taylor-example"><button>Submit application</button></main>`;

async function seed(page: Page): Promise<void> {
  await page.evaluate(async (jobs) => {
    const DAY = 86_400_000;
    const entries: Record<string, unknown> = {};
    jobs.forEach((j, i) => {
      const at = Date.now() - j.days * DAY;
      const id = `shot${String(i)}`;
      let from = 'applied';
      const activity = (j.path ?? []).map((to, k) => {
        const move = {
          id: `${id}-${String(k)}`,
          at: new Date(at + (k + 1) * 3 * DAY).toISOString(),
          type: 'stage_changed',
          fromStageId: from,
          toStageId: to,
        };
        from = to;
        return move;
      });
      entries[`job:${id}`] = {
        id,
        title: j.title,
        company: j.company,
        location: j.location,
        employmentTypes: ['full-time'],
        ...(j.salary
          ? { salary: { min: j.salary[0], max: j.salary[1], currency: 'AUD', period: 'year' } }
          : {}),
        stageId: j.stageId,
        rank: (i + 1) * 1024,
        priority: j.priority,
        tags: j.tags ?? [],
        notes: '',
        activity,
        createdAt: new Date(at).toISOString(),
        updatedAt: new Date(at).toISOString(),
        ...(j.stageId === 'saved' ? {} : { appliedAt: new Date(at).toISOString() }),
        ...(j.company === 'Summit Robotics'
          ? {
              contacts: [
                {
                  id: 'c1',
                  name: 'Priya Raman',
                  role: 'Talent partner',
                  email: 'priya@summit.example',
                },
              ],
              rounds: [
                {
                  id: 'r1',
                  kind: 'technical',
                  at: new Date(Date.now() + 2 * DAY).toISOString(),
                  with: 'Priya Raman',
                  notes: 'System design, 60 min',
                },
              ],
              documents: [{ id: 'd1', kind: 'resume', name: 'Sam Taylor - Resume.pdf' }],
            }
          : {}),
        source: {
          url: `https://careers.example.com/jobs/${id}`,
          originalUrl: `https://careers.example.com/jobs/${id}`,
          siteId: 'generic',
          siteName: 'careers.example.com',
          capturedAt: new Date(at).toISOString(),
        },
      };
    });
    await chrome.storage.local.set(entries);
  }, JOBS);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), 'rolestash-store-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: VIEWPORT,
    args: [
      '--headless=new',
      `--disable-extensions-except=${EXTENSION}`,
      `--load-extension=${EXTENSION}`,
    ],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const board = `chrome-extension://${id}/board.html`;
    const open = async (url: string) => {
      const page = await context.newPage();
      await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
      await page.goto(url);
      await page.evaluate(() => document.fonts.ready);
      await page.mouse.move(0, 0);
      return page;
    };
    const save = async (page: Page, name: string) => {
      // No focus rings in the shots.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.screenshot({ path: join(OUT, name), animations: 'disabled' });
      console.log(`.output/store-screenshots/${name}`);
    };

    const first = await open(board);
    await seed(first);
    // The "pin Rolestash" tip is for real installs, not the store.
    await first.evaluate(() => chrome.storage.local.set({ 'tips:pinDismissed': true }));
    // A fictional autofill profile, so the side panel offers "Fill this application".
    await first.evaluate(() =>
      chrome.storage.local.set({
        profile: {
          firstName: 'Sam',
          lastName: 'Taylor',
          email: 'sam.taylor@example.com',
          answers: [],
        },
      }),
    );
    await first.close();

    // 1. The board.
    let page = await open(board);
    await page.getByText('Junior Developer').waitFor();
    await save(page, '1-board.png');
    await page.close();

    // 2. A job's details: an interview round and a contact.
    page = await open(`${board}#job=shot6`);
    await page.getByRole('dialog', { name: 'Backend Developer details' }).waitFor();
    await save(page, '2-job-details.png');
    await page.close();

    // 3. Insights: where applications end up.
    page = await open(board);
    await page.getByRole('button', { name: 'Insights' }).click();
    const chart = page.getByRole('img', { name: 'Where applications end up' });
    await chart.scrollIntoViewIfNeeded();
    await save(page, '3-insights.png');
    await page.close();

    // 4. The side panel beside a careers page: two captures, composed by Chromium.
    const careers = await context.newPage();
    await careers.setViewportSize({ width: 880, height: 800 });
    await careers.setContent(CAREERS_PAGE);
    const left = (await careers.screenshot()).toString('base64');
    await careers.close();
    const panel = await open(`chrome-extension://${id}/sidepanel.html`);
    await panel.setViewportSize({ width: 400, height: 800 });
    await panel.getByRole('button', { name: 'Today' }).waitFor();
    const right = (await panel.screenshot()).toString('base64');
    await panel.close();
    page = await context.newPage();
    await page.setContent(
      `<body style="margin:0;display:flex;background:#e5e7eb"><img src="data:image/png;base64,${left}" width="880" height="800"><img src="data:image/png;base64,${right}" width="400" height="800" style="box-shadow:-1px 0 0 #d1d5db"></body>`,
    );
    await save(page, '4-side-panel.png');
    await page.close();

    // 5. The autofill profile, started from a résumé (from an empty profile).
    page = await open(board);
    await page.evaluate(() => chrome.storage.local.remove('profile'));
    await page.goto(`${board}#profile`);
    const dialog = page.getByRole('dialog', { name: 'Autofill profile' });
    await dialog
      .getByLabel('Choose your résumé')
      .setInputFiles(join(ROOT, 'tests/fixtures/resumes/files/classic.pdf'));
    await dialog.getByLabel('First name').and(page.locator('[value="Sam"]')).waitFor();
    await page.waitForTimeout(4500); // let the toast fade
    await save(page, '5-autofill.png');
    await page.close();
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

await main();
