import { expect, test as base, type Page } from '@playwright/test';
import { E2E_CODE, startMockBackend, type MockBackend } from '../e2e/mock-backend';
import { serveBoard } from './serve-board';

/** The web board (ADR-0017) in a plain browser, against the mock backend. */
const test = base.extend<{ backend: MockBackend; site: string }>({
  // eslint-disable-next-line no-empty-pattern
  backend: async ({}, use) => {
    const backend = await startMockBackend();
    await use(backend);
    await backend.close();
  },
  // eslint-disable-next-line no-empty-pattern
  site: async ({}, use) => {
    const board = await serveBoard();
    await use(board.origin);
    await board.close();
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
  await page.getByLabel('Email', { exact: true }).fill('jo@example.com');
  await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
  await page.getByLabel(/Code sent to/).fill(E2E_CODE);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test('offers Advanced to other plans', async ({ page, site, backend }) => {
  expect(backend.devices).toEqual([]);
  backend.entitlement = {
    status: 'active',
    tier: 'pro',
    trial_ends_at: null,
    current_period_end: new Date(Date.now() + 20 * 86_400_000).toISOString(),
    provider_customer_id: null,
  };
  await signIn(page, site);
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

const ADVANCED = {
  status: 'active',
  tier: 'advanced',
  trial_ends_at: null,
  current_period_end: new Date(Date.now() + 20 * 86_400_000).toISOString(),
  provider_customer_id: 'ctm_1',
};
const encodeState = (state: object) => Buffer.from(JSON.stringify(state)).toString('base64url');

test('Google: goes to Google for this site, and signs in on the way back', async ({
  page,
  site,
  backend,
}) => {
  backend.entitlement = ADVANCED;
  let googleUrl: URL | undefined;
  await page.route('https://accounts.google.com/**', async (route) => {
    googleUrl = new URL(route.request().url());
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Google</title>' });
  });
  await page.goto(`${site}/board/`);
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect
    .poll(() => googleUrl?.searchParams.get('redirect_uri'))
    .toBe('https://rolestash.com/auth/google/');
  const state = JSON.parse(
    Buffer.from(googleUrl?.searchParams.get('state') ?? '', 'base64url').toString(),
  ) as { e: string; s: string };
  expect(state.e).toBe('web');

  // rolestash.com/auth/google/ forwards Google's answer to /board/ (same tab).
  await page.goto(`${site}/board/#id_token=google-id-token&state=${encodeState(state)}`);
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  expect(page.url()).not.toContain('id_token'); // never left in the address bar
  const exchange = backend.requests.find((r) => r.path === '/auth/v1/token');
  expect(exchange?.body).toMatchObject({ provider: 'google', id_token: 'google-id-token' });
});

test('Google: refuses an answer this tab did not ask for', async ({ page, site, backend }) => {
  await page.goto(`${site}/board/#id_token=forged&state=${encodeState({ e: 'web', s: 'other' })}`);
  await expect(page.getByText('That sign-in link has expired. Please try again.')).toBeVisible();
  expect(backend.requests.some((r) => r.path === '/auth/v1/token')).toBe(false);
});
