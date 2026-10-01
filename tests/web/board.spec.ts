import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';
import { E2E_CODE, MOCK_BACKEND, startMockBackend, type MockBackend } from '../e2e/mock-backend';

/**
 * The web board (ADR-0017) in a plain browser, against the mock backend. The
 * page is served with the board's real CSP from site/_headers (pointed at the
 * mock), so any inline script or stray request would fail the test.
 */
const ROOT = resolve(import.meta.dirname, '../..');
const BUILD = join(ROOT, '.output/web-e2e');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

function boardCsp(): string {
  const headers = readFileSync(join(ROOT, 'site/_headers'), 'utf8');
  const csp = /Content-Security-Policy: (.+)$/m.exec(
    headers.slice(headers.indexOf('/board/*')),
  )?.[1];
  if (!csp) throw new Error('No board CSP');
  // Same policy, with connect-src pointed at the mock backend.
  return csp
    .replace(/connect-src [^;]+;/, `connect-src ${MOCK_BACKEND};`)
    .replace(' upgrade-insecure-requests', '');
}

const test = base.extend<{ backend: MockBackend; site: string }>({
  // eslint-disable-next-line no-empty-pattern
  backend: async ({}, use) => {
    const backend = await startMockBackend();
    await use(backend);
    await backend.close();
  },
  // eslint-disable-next-line no-empty-pattern
  site: async ({}, use) => {
    if (!existsSync(BUILD)) throw new Error('Run `npm run build:web:e2e` first.');
    const csp = boardCsp();
    const server: Server = createServer((req, res) => {
      const path = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
      const file = path.startsWith('/board/')
        ? normalize(join(BUILD, path.slice('/board/'.length) || 'index.html'))
        : normalize(join(ROOT, 'site', path));
      if (!file.startsWith(BUILD) && !file.startsWith(join(ROOT, 'site')))
        return void res.writeHead(403).end();
      try {
        const body = readFileSync(file);
        res.writeHead(200, {
          'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
          'Content-Security-Policy': csp,
        });
        res.end(body);
      } catch {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const address = server.address();
    await use(
      `http://127.0.0.1:${String(typeof address === 'object' && address ? address.port : 0)}`,
    );
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  },
});

const job = (id: string, extra: Record<string, unknown> = {}) => {
  const now = new Date().toISOString();
  return {
    id,
    title: 'Untitled',
    company: '',
    employmentTypes: [],
    stageId: 'applied',
    rank: 1024,
    priority: 0,
    tags: [],
    notes: '',
    activity: [],
    createdAt: now,
    updatedAt: now,
    source: {
      url: `https://example.com/jobs/${id}`,
      originalUrl: `https://example.com/jobs/${id}`,
      siteId: 'generic',
      siteName: 'example.com',
      capturedAt: now,
    },
    ...extra,
  };
};

function seed(backend: MockBackend, data: ReturnType<typeof job>) {
  backend.synced.set(data.id, {
    data,
    deleted: false,
    updated_at: data.updatedAt,
    revision: ++backend.revision,
  });
}

async function signIn(page: Page, site: string) {
  await page.goto(`${site}/board/`);
  await page.getByLabel('Email').fill('jo@example.com');
  await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
  await page.getByLabel(/Code sent to/).fill(E2E_CODE);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test('offers Advanced to other plans', async ({ page, site, backend }) => {
  expect(backend.devices).toEqual([]);
  await signIn(page, site); // the mock signs in on a Pro trial
  await expect(
    page.getByRole('heading', { name: 'The web board is part of Advanced' }),
  ).toBeVisible();
});

test('Advanced: Today, the board, quick updates and quick add, synced back', async ({
  page,
  site,
  backend,
}) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  backend.entitlement = {
    status: 'active',
    tier: 'advanced',
    trial_ends_at: null,
    current_period_end: new Date(Date.now() + 20 * 86_400_000).toISOString(),
    provider_customer_id: 'ctm_1',
  };
  seed(
    backend,
    job('due', {
      title: 'Backend Developer',
      company: 'Summit Robotics',
      followUpAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), // two days ago
    }),
  );
  seed(
    backend,
    job('saved', {
      title: 'Product Designer',
      company: 'Tidewater Studio',
      stageId: 'saved',
      closesAt: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
    }),
  );

  await signIn(page, site);

  // Today: the due follow-up and the job closing tomorrow.
  const followUps = page.getByRole('region', { name: 'Follow-ups' });
  await expect(followUps.getByText('Backend Developer')).toBeVisible();
  await expect(followUps).toContainText('Follow-up overdue');
  await expect(page.getByRole('region', { name: 'Closing soon: not applied yet' })).toContainText(
    'Product Designer',
  );
  expect(backend.devices).toEqual([expect.objectContaining({ kind: 'web' })]);

  // Move it to Interviewing and add a note, from the phone.
  await followUps.getByText('Backend Developer').click();
  const sheet = page.getByRole('dialog', { name: 'Backend Developer details' });
  await sheet.getByRole('combobox').selectOption({ label: 'Interviewing' });
  await sheet.getByLabel('Notes').fill('Panel on Thursday');
  await sheet.getByRole('button', { name: 'Close' }).click();

  // Board tab shows it in its new column.
  await page.getByRole('button', { name: 'Board' }).click();
  await page.getByRole('tab', { name: /Interviewing/ }).click();
  await expect(page.getByText('Backend Developer')).toBeVisible();

  // Quick add.
  await page.getByRole('button', { name: 'Add a job' }).click();
  const add = page.getByRole('dialog', { name: 'Add a job' });
  await add.getByLabel('Job title').fill('Data Analyst');
  await add.getByLabel('Company').fill('Kestrel Health');
  await add.getByRole('button', { name: 'Add job' }).click();
  await expect(page.getByRole('dialog', { name: 'Data Analyst details' })).toBeVisible();

  // Everything syncs back.
  await expect
    .poll(
      () => {
        const moved = backend.synced.get('due')?.data as
          { stageId?: string; notes?: string } | undefined;
        const added = [...backend.synced.values()].some(
          (r) => (r.data as { title?: string } | null)?.title === 'Data Analyst',
        );
        return `${moved?.stageId ?? ''}|${moved?.notes ?? ''}|${String(added)}`;
      },
      { timeout: 15_000 },
    )
    .toBe('interviewing|Panel on Thursday|true');
  expect(errors).toEqual([]);
});
