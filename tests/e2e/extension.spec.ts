import type { ExtractionResult } from '@/extraction';
import type { Job } from '@/domain/job';
import type { Worker } from '@playwright/test';
import { expect, test } from './fixtures';

/** Runs the bundled extractor in the tab showing `url`, from the service worker. */
async function extractInTab(worker: Worker, url: string) {
  return worker.evaluate(async (target) => {
    const [tab] = await chrome.tabs.query({ url: target });
    if (tab?.id === undefined) throw new Error('fixture tab not found');
    const injections = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['/extractor.js'],
    });
    return injections.map((i) => i.result as ExtractionResult);
  }, url);
}

test.describe('extractor injection', () => {
  test('returns a serialisable result from a real page', async ({
    context,
    worker,
    fixtureServer,
  }) => {
    const page = await context.newPage();
    const url = fixtureServer.url('sites/greenhouse/board.html');
    await page.goto(url);
    const [result] = await extractInTab(worker, url);
    expect(result?.fields.title).toBe('Backend Engineer (Payments)');
    expect(result?.fields.company).toBe('Airwallex');
    expect(result?.provenance.title?.strategy).toBe('json-ld');
  });

  test('falls back to heuristics on an unknown site', async ({
    context,
    worker,
    fixtureServer,
  }) => {
    const page = await context.newPage();
    const url = fixtureServer.url('sites/generic/company-careers.html');
    await page.goto(url);
    const [result] = await extractInTab(worker, url);
    expect(result?.site.id).toBe('generic');
    expect(result?.fields.title).toBe('Site Reliability Engineer');
  });
});

test.describe('board', () => {
  const seed = (worker: Worker, jobs: Partial<Job>[]) =>
    worker.evaluate(async (items) => {
      const now = new Date().toISOString();
      const entries = Object.fromEntries(
        items.map((j, i) => [
          `job:${j.id}`,
          {
            title: 'Untitled',
            company: '',
            employmentTypes: [],
            stageId: 'saved',
            rank: (i + 1) * 1024,
            priority: 0,
            tags: [],
            notes: '',
            activity: [],
            createdAt: now,
            updatedAt: now,
            source: {
              url: `https://example.com/jobs/${j.id}`,
              originalUrl: `https://example.com/jobs/${j.id}`,
              siteId: 'generic',
              siteName: 'example.com',
              capturedAt: now,
            },
            ...j,
          },
        ]),
      );
      await chrome.storage.local.set(entries);
    }, jobs);

  test('shows the empty state on first run', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/board.html`);
    await expect(page.getByRole('heading', { name: 'Your job board is empty' })).toBeVisible();
  });

  test('renders seeded jobs in their columns and opens the drawer', async ({
    context,
    worker,
    extensionId,
  }) => {
    await seed(worker, [
      { id: 'a', title: 'Platform Engineer', company: 'Canva', stageId: 'saved' },
      { id: 'b', title: 'Data Scientist', company: 'Atlassian', stageId: 'interviewing' },
    ]);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/board.html`);
    const interviewing = page.getByRole('region', { name: 'Interviewing column' });
    await expect(interviewing.getByText('Data Scientist')).toBeVisible();

    await page.getByText('Platform Engineer').click();
    const drawer = page.getByRole('dialog', { name: 'Platform Engineer details' });
    await expect(drawer).toBeVisible();
    await drawer.getByLabel('Notes').fill('Referral from Priya');
    await drawer.getByRole('button', { name: 'Close' }).click();

    await expect
      .poll(() =>
        worker.evaluate(
          async () => ((await chrome.storage.local.get('job:a'))['job:a'] as Job).notes,
        ),
      )
      .toBe('Referral from Priya');
  });

  test('drag and drop moves a job to another column and persists it', async ({
    context,
    worker,
    extensionId,
  }) => {
    await seed(worker, [
      { id: 'a', title: 'Frontend Engineer', company: 'Canva', stageId: 'saved' },
    ]);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`chrome-extension://${extensionId}/board.html`);

    const card = page.getByRole('button', { name: /Frontend Engineer/ });
    const target = page.getByRole('region', { name: 'Applied column' });
    const from = await card.boundingBox();
    const to = await target.boundingBox();
    if (!from || !to) throw new Error('layout not ready');

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 20, from.y + 20, { steps: 5 });
    await page.mouse.move(to.x + to.width / 2, to.y + 120, { steps: 15 });
    await page.mouse.up();

    await expect(target.getByText('Frontend Engineer')).toBeVisible();
    await expect
      .poll(() =>
        worker.evaluate(
          async () => ((await chrome.storage.local.get('job:a'))['job:a'] as Job).stageId,
        ),
      )
      .toBe('applied');
    const job = await worker.evaluate(
      async () => (await chrome.storage.local.get('job:a'))['job:a'] as Job,
    );
    expect(job.appliedAt).toBeTruthy();
    expect(job.activity.at(-1)?.type).toBe('stage_changed');
  });

  test('search filters cards', async ({ context, worker, extensionId }) => {
    await seed(worker, [
      { id: 'a', title: 'Platform Engineer', company: 'Canva' },
      { id: 'b', title: 'Designer', company: 'Atlassian' },
    ]);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/board.html`);
    await page.getByLabel('Search jobs').fill('atlassian');
    await expect(page.getByText('Designer')).toBeVisible();
    await expect(page.getByText('Platform Engineer')).toBeHidden();
  });
});
