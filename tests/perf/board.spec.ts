// Board performance probe, opt-in: `npm run perf:board` (docs/guides/testing.md).
// Seeds PERF_N jobs into the production build, slows the CPU by PERF_CPU, and
// times opening the board, a search, a drag between columns and the drawer.
import { expect, test } from '../e2e/fixtures';

const N = Number(process.env.PERF_N ?? 1000);
const CPU = Number(process.env.PERF_CPU ?? 4);
const STAGES = ['saved', 'applied', 'screening', 'interviewing', 'offer', 'rejected'];

test.setTimeout(300_000);

test(`board with ${String(N)} jobs`, async ({ context, worker, extensionId }) => {
  await worker.evaluate(
    async ({ n, stages }) => {
      const now = new Date().toISOString();
      const description = 'Build and ship systems with a small team. '.repeat(80);
      const entries: Record<string, unknown> = {};
      for (let i = 0; i < n; i++) {
        const id = `p${String(i)}`;
        entries[`job:${id}`] = {
          id,
          title: `Engineer ${String(i)}`,
          company: `Company ${String(i % 300)}`,
          location: 'Sydney NSW',
          employmentTypes: [],
          stageId: stages[i % stages.length],
          rank: (i + 1) * 1024,
          priority: i % 3,
          tags: i % 4 ? ['remote'] : [],
          notes: '',
          description,
          activity: [{ id: `a${id}`, type: 'created', at: now }],
          createdAt: now,
          updatedAt: now,
          source: {
            url: `https://example.com/jobs/${id}`,
            originalUrl: `https://example.com/jobs/${id}`,
            siteId: 'generic',
            siteName: 'example.com',
            capturedAt: now,
          },
        };
      }
      await chrome.storage.local.set(entries);
    },
    { n: N, stages: STAGES },
  );

  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  // Checks run in the page or the worker: Playwright's text locators walk the
  // whole DOM on every poll, which would dominate the timings.
  const card = (n: number) => `[aria-label^="Engineer ${String(n)} at"]`;

  const t0 = Date.now();
  await page.goto(`chrome-extension://${extensionId}/board.html`);
  await page.waitForFunction((sel) => document.querySelector(sel), card(Math.min(N, 300) - 1), {
    timeout: 120_000,
    polling: 'raf',
  });
  const open = Date.now() - t0;
  const nodes = await page.evaluate(() => document.querySelectorAll('*').length);

  const t1 = Date.now();
  await page.getByLabel('Search jobs').fill('Engineer 7');
  await page.waitForFunction((sel) => !document.querySelector(sel), card(0), { polling: 'raf' });
  const search = Date.now() - t1;
  await page.getByLabel('Search jobs').fill('');
  await page.waitForFunction((sel) => document.querySelector(sel), card(0), { polling: 'raf' });

  const from = await page.locator(card(0)).boundingBox();
  const to = await page.getByRole('region', { name: 'Applied column' }).boundingBox();
  if (!from || !to) throw new Error('layout not ready');
  const t2 = Date.now();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + 20, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 120, { steps: 15 });
  await page.mouse.up();
  await page.waitForFunction(
    (sel) => document.querySelector('[aria-label="Applied column"]')?.querySelector(sel),
    card(0),
    { timeout: 60_000, polling: 'raf' },
  );
  const drag = Date.now() - t2;

  const t3 = Date.now();
  await page.locator(card(3)).click();
  await expect(page.getByRole('dialog', { name: 'Engineer 3 details' })).toBeVisible({
    timeout: 60_000,
  });
  const drawer = Date.now() - t3;

  console.log(
    `board n=${String(N)} cpu=${String(CPU)}x: open ${String(open)} ms, search ${String(search)} ms, ` +
      `drag ${String(drag)} ms, drawer ${String(drawer)} ms, ${String(nodes)} DOM nodes`,
  );
});
