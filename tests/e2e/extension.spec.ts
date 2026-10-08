import { readFileSync } from 'node:fs';
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

test.describe('autofill injection (ADR-0020)', () => {
  test('fills a real application form from the profile, and leaves the rest', async ({
    context,
    worker,
    fixtureServer,
  }) => {
    const page = await context.newPage();
    const url = fixtureServer.url('forms/generic/careers-page.html');
    await page.goto(url);
    const reports = await worker.evaluate(async (target) => {
      const [tab] = await chrome.tabs.query({ url: target });
      const tabId = tab!.id!;
      await chrome.scripting.executeScript({ target: { tabId }, files: ['/autofill.js'] });
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (profile: unknown) =>
          (
            globalThis as unknown as { __rolestashAutofill: (p: unknown) => Promise<unknown> }
          ).__rolestashAutofill(profile),
        args: [
          {
            firstName: 'Sam',
            lastName: 'Taylor',
            email: 'sam@example.com',
            region: 'Victoria',
            needsSponsorship: 'no',
            answers: [],
          },
        ],
      });
      return results.map(
        (r) => r.result as { filled: { key: string }[]; skipped: { reason: string }[] },
      );
    }, url);

    expect(reports[0]?.filled.map((f) => f.key)).toEqual([
      'firstName',
      'lastName',
      'email',
      'region',
      'needsSponsorship',
    ]);
    await expect(page.locator('[name="fname"]')).toHaveValue('Sam');
    await expect(page.locator('[name="st"]')).toHaveValue('VIC');
    await expect(page.locator('[name="spons"][value="n"]')).toBeChecked();
    await expect(page.locator('[name="g"]')).toHaveValue('');
    await expect(page.locator('[name="li"]')).toHaveValue('https://linkedin.com/in/already-typed');
  });
});

// @smoke: also runs against the production build (npm run test:smoke).
test.describe('board @smoke', () => {
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
    await expect(
      page.getByRole('heading', { name: 'Your board is ready for its first job' }),
    ).toBeVisible();
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

  test('long columns show their first 50 cards, then more on request', async ({
    context,
    worker,
    extensionId,
  }) => {
    await seed(
      worker,
      Array.from({ length: 60 }, (_, i) => ({
        id: `j${String(i)}`,
        title: `Role ${String(i + 1)}`,
        company: 'Acme',
      })),
    );
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/board.html`);
    const saved = page.getByRole('region', { name: 'Saved column' });
    await expect(saved.getByText('Role 50', { exact: true })).toBeVisible();
    await expect(saved.getByText('Role 51', { exact: true })).toHaveCount(0);
    await expect(saved.getByText('60', { exact: true })).toBeVisible(); // the count is all of them
    await saved.getByRole('button', { name: 'Show 10 more' }).click();
    await expect(saved.getByText('Role 60', { exact: true })).toBeAttached();
    await expect(saved.getByRole('button', { name: /^Show \d+ more/ })).toHaveCount(0);
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

  test('archives a job into History and restores it', async ({ context, worker, extensionId }) => {
    await seed(worker, [
      { id: 'a', title: 'Platform Engineer', company: 'Northwind Labs' },
      { id: 'b', title: 'Designer', company: 'Tidewater Studio' },
    ]);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/board.html`);
    await page.getByText('Platform Engineer').click();
    const drawer = page.getByRole('dialog', { name: 'Platform Engineer details' });
    await drawer.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Archive' }).click();
    await expect(
      page.getByRole('region', { name: 'Saved column' }).getByText('Platform Engineer'),
    ).toBeHidden();

    await page.getByRole('button', { name: 'History' }).click();
    const history = page.getByRole('dialog', { name: 'History' });
    await history.getByRole('tab', { name: 'Archived' }).click();
    await expect(history.getByText('Platform Engineer')).toBeVisible();
    await history.getByRole('button', { name: 'Restore' }).click();
    await expect(history.getByText('Platform Engineer')).toBeHidden();
    await history.getByRole('button', { name: 'Close' }).click();
    await expect(
      page.getByRole('region', { name: 'Saved column' }).getByText('Platform Engineer'),
    ).toBeVisible();

    const job = await worker.evaluate(
      async () => (await chrome.storage.local.get('job:a'))['job:a'] as Job,
    );
    expect(job.archivedAt).toBeUndefined();
    expect(job.activity.map((a) => a.type)).toEqual(['archived', 'unarchived']);
  });

  test('upgrades a 0.4.7 board to the current lanes (ADR-0034)', async ({
    context,
    worker,
    extensionId,
  }) => {
    // The fresh install's own first migration must finish first, or it would
    // stamp schema v2 over the 0.4.7 data seeded below.
    await expect
      .poll(() =>
        worker.evaluate(
          async () =>
            (
              (await chrome.storage.local.get('meta')).meta as
                { schemaVersion?: number } | undefined
            )?.schemaVersion,
        ),
      )
      .toBe(2);
    // What 0.4.7 stores: schema v1, the seven columns, jobs in Screening and Withdrawn.
    // Jobs first, then schema and columns in one write: a migration that starts
    // after that write always sees the jobs.
    await seed(worker, [
      { id: 's', title: 'Platform Engineer', company: 'Northwind Labs', stageId: 'screening' },
      { id: 'w', title: 'Data Analyst', company: 'Kestrel Health', stageId: 'withdrawn' },
    ]);
    await worker.evaluate(async () => {
      const col = (
        id: string,
        name: string,
        color: string,
        kind: string,
        marksApplied: boolean,
      ) => ({
        id,
        name,
        color,
        kind,
        marksApplied,
      });
      await chrome.storage.local.set({
        meta: { schemaVersion: 1 },
        settings: {
          stages: [
            col('saved', 'Saved', 'slate', 'active', false),
            col('applied', 'Applied', 'sky', 'active', true),
            col('screening', 'Screening', 'violet', 'active', true),
            col('interviewing', 'Interviewing', 'amber', 'active', true),
            col('offer', 'Offer', 'emerald', 'won', true),
            col('rejected', 'Rejected', 'rose', 'lost', false),
            col('withdrawn', 'Withdrawn', 'zinc', 'lost', false),
          ],
          defaultStageId: 'saved',
          theme: 'system',
        },
      });
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/board.html`);
    await expect(
      page.getByRole('region', { name: 'Interviewing column' }).getByText('Platform Engineer'),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: /column$/ })).toHaveCount(5);
    // The withdrawn job is now in Rejected, the fifth lane.
    await expect(
      page.getByRole('region', { name: 'Rejected column' }).getByText('Data Analyst'),
    ).toBeVisible();

    await page.getByRole('button', { name: 'History' }).click();
    const history = page.getByRole('dialog', { name: 'History' });
    await expect(history.getByText('Data Analyst')).toBeVisible();

    const stored = await worker.evaluate(async () => {
      const data = await chrome.storage.local.get(['meta', 'settings', 'job:w']);
      return {
        meta: data.meta as { schemaVersion: number },
        stages: (data.settings as { stages: { id: string }[] }).stages.map((x) => x.id),
        job: data['job:w'] as Job,
      };
    });
    expect(stored.meta.schemaVersion).toBe(2);
    expect(stored.stages).toEqual(['saved', 'applied', 'interviewing', 'offer', 'rejected']);
    expect(stored.job.stageId).toBe('rejected');
    expect(stored.job.activity.at(-1)).toMatchObject({
      fromStageId: 'withdrawn',
      toStageId: 'rejected',
    });
  });

  test('exports the board to CSV', async ({ context, worker, extensionId }) => {
    await seed(worker, [
      { id: 'a', title: 'Platform Engineer', company: 'Northwind Labs', tags: ['go'] },
      { id: 'b', title: 'Designer', company: 'Tidewater Studio', stageId: 'applied' },
    ]);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/board.html`);
    await page.getByRole('button', { name: 'Board menu' }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: 'Export to CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^rolestash-jobs-\d{4}-\d{2}-\d{2}\.csv$/);
    const path = await download.path();
    const text = readFileSync(path, 'utf8');
    const lines = text
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');
    expect(lines[0]).toMatch(/^Title,Company,Stage,/);
    expect(lines.slice(1).map((l) => l.split(',').slice(0, 3).join(','))).toEqual([
      'Platform Engineer,Northwind Labs,Saved',
      'Designer,Tidewater Studio,Applied',
    ]);
  });
});

// Needs an accounts build (Free vs Pro), so not part of @smoke.
test.describe('reminders', () => {
  const seed = (worker: Worker, jobs: Partial<Job>[]) =>
    worker.evaluate(async (items) => {
      const now = new Date().toISOString();
      await chrome.storage.local.set(
        Object.fromEntries(
          items.map((j, i) => [
            `job:${String(j.id)}`,
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
                url: `https://example.com/jobs/${String(j.id)}`,
                originalUrl: `https://example.com/jobs/${String(j.id)}`,
                siteId: 'generic',
                siteName: 'example.com',
                capturedAt: now,
              },
              ...j,
            },
          ]),
        ),
      );
    }, jobs);

  test('schedules reminder checks and offers follow-ups on Pro', async ({
    context,
    worker,
    extensionId,
  }) => {
    await expect
      .poll(() =>
        worker.evaluate(
          async () => (await chrome.alarms.get('rolestash.reminders'))?.periodInMinutes,
        ),
      )
      .toBe(15);
    await seed(worker, [{ id: 'a', title: 'Platform Engineer', company: 'Northwind Labs' }]);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/board.html`);
    await page.getByText('Platform Engineer').click();
    const drawer = page.getByRole('dialog', { name: 'Platform Engineer details' });
    // Signed out is the Free plan: reminders are offered, not active.
    await expect(drawer.getByText(/Pro reminds you when it's time to follow up/)).toBeVisible();
  });
});

test.describe('the floating widget (ADR-0030)', () => {
  test('appears on a job site, saves the job and moves it to Applied', async ({
    context,
    worker,
    fixtureServer,
  }) => {
    const page = await context.newPage();
    await page.goto(fixtureServer.url('sites/greenhouse/board.html'));
    await page.getByRole('button', { name: 'Open Rolestash' }).click();
    const widget = page.frameLocator('iframe[title="Rolestash"]');
    await expect(widget.getByText('Backend Engineer (Payments)')).toBeVisible();
    await expect(widget.getByText(/A\$160K – 200K/)).toBeVisible();
    // The launcher steps aside while the panel is open.
    await expect(page.getByRole('button', { name: 'Open Rolestash' })).toHaveCount(0);

    await widget.getByRole('button', { name: 'Save job' }).click();
    await expect(widget.getByRole('status')).toHaveText('Saved · Saved');
    // The panel grows to fit the saved view, upwards from the bottom of the window:
    // wait until it has settled, or the click lands where the chip used to be.
    const frame = page.locator('iframe[title="Rolestash"]');
    let last = -1;
    await expect
      .poll(async () => {
        const top = (await frame.boundingBox())?.y ?? -1;
        const settled = top === last;
        last = top;
        return settled;
      })
      .toBe(true);
    await widget.getByRole('radio', { name: 'Applied' }).click();
    await expect(widget.getByRole('status')).toHaveText('On your board · Applied');
    const stored = await worker.evaluate(async () =>
      Object.entries(await chrome.storage.local.get(null))
        .filter(([key]) => key.startsWith('job:'))
        .map(([, job]) => (job as { title: string; stageId: string }).stageId),
    );
    expect(stored).toEqual(['applied']);

    // Closing and opening again finds it on the board.
    await widget.getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('iframe[title="Rolestash"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Open Rolestash' }).click();
    await expect(widget.getByRole('status')).toHaveText('On your board · Applied');
  });

  test('is a logo on other pages, says "Save job" on a job, and can be dragged to either edge', async ({
    context,
    worker,
    fixtureServer,
  }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    // Not a job posting: only the logo.
    await page.goto(fixtureServer.url('forms/generic/careers-page.html'));
    const button = page.getByRole('button', { name: 'Open Rolestash' });
    await expect(button).toBeVisible();
    await expect(button.getByText('Save job')).toBeHidden();
    const start = await button.boundingBox();
    expect(start?.width).toBe(48);
    expect((start?.x ?? 0) + (start?.width ?? 0)).toBeGreaterThan(1200); // right edge by default

    // Press: it sinks in. Drag to the left half and let go: it snaps to the left edge.
    await page.mouse.move((start?.x ?? 0) + 24, (start?.y ?? 0) + 24);
    await page.mouse.down();
    await expect(button).toHaveClass(/pressed/);
    await page.mouse.move(300, 250, { steps: 8 });
    await expect(button).toHaveClass(/dragging/);
    await page.mouse.up();
    await expect(button).not.toHaveClass(/pressed/);
    await expect.poll(async () => (await button.boundingBox())?.x).toBe(12);
    // A drag isn't a click: the panel stays shut.
    await expect(page.locator('iframe[title="Rolestash"]')).toHaveCount(0);
    expect(
      await worker.evaluate(
        async () => (await chrome.storage.local.get('widget:position'))['widget:position'],
      ),
    ).toMatchObject({ side: 'left' });

    // Remembered on the next page, where a job is open: "Save job", and the panel opens on the left.
    await page.goto(fixtureServer.url('sites/greenhouse/board.html'));
    await expect(button.getByText('Save job')).toBeVisible();
    await expect.poll(async () => (await button.boundingBox())?.x).toBe(12);
    await button.click();
    const panel = await page.locator('iframe[title="Rolestash"]').boundingBox();
    expect(panel?.x).toBeLessThan(100);
  });

  test('the toolbar icon toggles it, and it can be hidden on a site', async ({
    context,
    worker,
    fixtureServer,
  }) => {
    expect(await worker.evaluate(() => chrome.action.getPopup({}))).toBe('');
    const url = fixtureServer.url('sites/generic/company-careers.html');
    const page = await context.newPage();
    await page.goto(url);
    await expect(page.getByRole('button', { name: 'Open Rolestash' })).toBeVisible();
    // What the toolbar click does (background.ts → toggleWidget).
    const toggle = () =>
      worker.evaluate(async (target) => {
        const [tab] = await chrome.tabs.query({ url: target });
        await chrome.tabs.sendMessage(tab!.id!, { type: 'rolestash:widget-toggle' });
      }, url);
    await toggle();
    const widget = page.frameLocator('iframe[title="Rolestash"]');
    await expect(widget.getByLabel('Job title')).toHaveValue('Site Reliability Engineer');
    await widget.getByRole('button', { name: 'More' }).click();
    await widget.getByRole('menuitem', { name: 'Hide the button on 127.0.0.1' }).click();
    await expect(page.locator('iframe[title="Rolestash"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open Rolestash' })).toHaveCount(0);
    await page.reload();
    await page.waitForTimeout(500);
    await expect(page.getByRole('button', { name: 'Open Rolestash' })).toHaveCount(0);
    // The icon still opens it there.
    await toggle();
    await expect(widget.getByLabel('Job title')).toBeVisible();
  });

  test('with all-sites access, the button is registered for every other page too (ADR-0033)', async ({
    worker,
  }) => {
    // E2E builds hold all-sites access, as if the user had turned it on.
    await expect
      .poll(() =>
        worker.evaluate(async () => ({
          scripts: (await chrome.scripting.getRegisteredContentScripts()).map((s) => ({
            id: s.id,
            matches: [...(s.matches ?? [])].sort(),
            excluded: (s.excludeMatches ?? []).length,
          })),
          flag: (await chrome.storage.local.get('widget:allSites'))['widget:allSites'],
        })),
      )
      .toEqual({
        scripts: [
          {
            id: 'rolestash-launcher-all-sites',
            matches: ['http://*/*', 'https://*/*'],
            excluded: 100,
          },
        ],
        flag: true,
      });
  });
});
