import type { Worker } from '@playwright/test';
import { expect, test } from './fixtures';
import { E2E_CODE, MOCK_BACKEND } from './mock-backend';

/**
 * Accounts (ADR-0011). The E2E build is configured with the mock backend
 * (.env.e2e); the production build has no backend, which the smoke test
 * below checks.
 */

async function seedActiveJobs(worker: Worker, count: number) {
  await worker.evaluate(async (n) => {
    const now = new Date().toISOString();
    const entries: Record<string, unknown> = {};
    for (let i = 0; i < n; i++) {
      entries[`job:j${String(i)}`] = {
        id: `j${String(i)}`,
        title: `Role ${String(i)}`,
        company: 'Acme',
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
          url: `https://example.com/jobs/${String(i)}`,
          originalUrl: `https://example.com/jobs/${String(i)}`,
          siteId: 'generic',
          siteName: 'example.com',
          capturedAt: now,
        },
      };
    }
    await chrome.storage.local.set(entries);
  }, count);
}

async function seedSignedIn(worker: Worker, entitlement: Record<string, unknown>) {
  await worker.evaluate(async (e) => {
    await chrome.storage.local.set({
      'account:session': {
        accessToken: 'e2e-access',
        refreshToken: 'e2e-refresh',
        expiresAt: Date.now() + 3_600_000,
        user: { id: 'e2e-user', email: 'jo@example.com' },
      },
      'account:entitlement': { ...e, checkedAt: new Date().toISOString() },
    });
  }, entitlement);
}

test.describe('accounts', () => {
  test.skip(
    ({ extensionDir }) => !extensionDir.endsWith('-e2e'),
    'needs the backend-configured build',
  );

  test('signs in with an email code and starts the Pro trial', async ({
    context,
    extensionId,
    backend,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/board.html`);
    await page.getByRole('button', { name: 'Account', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Start your 30-day Pro trial')).toBeVisible();
    // The mock project enables Google, so the button is offered.
    await expect(dialog.getByRole('button', { name: 'Continue with Google' })).toBeVisible();

    await dialog.getByLabel('Email').fill('Jo@Example.com');
    await dialog.getByRole('button', { name: 'Email me a sign-in code' }).click();
    await dialog.getByLabel('Sign-in code').fill('000000');
    await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('wrong or has expired');

    await dialog.getByLabel('Sign-in code').fill(E2E_CODE);
    await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(dialog.getByText('Your account')).toBeVisible();
    await expect(dialog.getByText(/Pro trial: 30 days left/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Account', exact: true })).toContainText(
      'Pro trial · 30d',
    );

    const otp = backend.requests.find((r) => r.path === '/auth/v1/otp');
    expect(otp?.body).toEqual({ email: 'jo@example.com', create_user: true });
    expect(otp?.headers.apikey).toBe('e2e-anon-key');
    const read = backend.requests.find((r) => r.path === '/rest/v1/entitlements');
    expect(read?.headers.authorization).toBe('Bearer e2e-access');
  });

  test('the free plan stops the 16th active job with a clear way forward', async ({
    context,
    worker,
    extensionId,
    backend: _backend,
  }) => {
    await seedActiveJobs(worker, 15);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/board.html`);
    await expect(page.getByRole('status', { name: 'Plan notice' })).toContainText(
      "You've reached the Free plan's 15 active jobs",
    );

    await page.getByRole('button', { name: 'Add job' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Job title').fill('One too many');
    await dialog.getByRole('button', { name: /add/i }).last().click();
    await expect(dialog).toContainText('Your plan holds 15 active jobs');
    const count = await worker.evaluate(
      async () =>
        Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith('job:'))
          .length,
    );
    expect(count).toBe(15);

    // The banner leads signed-out users to the trial.
    await page.keyboard.press('Escape');
    await page.getByRole('status', { name: 'Plan notice' }).getByRole('button').click();
    await expect(page.getByRole('dialog')).toContainText('Start your 30-day Pro trial');
  });

  test('upgrading opens the checkout in a new tab', async ({
    context,
    worker,
    extensionId,
    backend,
  }) => {
    await seedSignedIn(worker, {
      status: 'trialing',
      trialEndsAt: new Date(Date.now() - 86_400_000).toISOString(),
      hasBillingAccount: false,
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/board.html#account`);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Your Pro trial has ended');

    const [checkout] = await Promise.all([
      context.waitForEvent('page'),
      dialog.getByRole('button', { name: 'US$7 / month' }).click(),
    ]);
    await checkout.waitForLoadState();
    expect(checkout.url()).toBe(`${MOCK_BACKEND}/pay/?_ptxn=txn_e2e`);
    const call = backend.requests.find((r) => r.path === '/functions/v1/create-checkout');
    expect(call?.body).toEqual({ tier: 'pro', interval: 'month' });
    expect(call?.headers.authorization).toBe('Bearer e2e-access');
  });

  test('custom columns: offered on Free, editable on Pro', async ({
    context,
    worker,
    extensionId,
  }) => {
    await seedActiveJobs(worker, 1); // an empty board shows a welcome, not columns
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/board.html`);
    await page.getByRole('button', { name: 'Board menu' }).click();
    await page.getByRole('menuitem', { name: 'Edit columns…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit columns' });
    await expect(dialog.getByText('Custom columns are part of Pro.')).toBeVisible();
    await expect(dialog.getByLabel('Name of Saved')).toBeDisabled();
    await dialog.getByRole('button', { name: 'Close' }).click();

    await seedSignedIn(worker, {
      status: 'trialing',
      trialEndsAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      hasBillingAccount: false,
    });
    await page.reload();
    await page.getByRole('button', { name: 'Board menu' }).click();
    await page.getByRole('menuitem', { name: 'Edit columns…' }).click();
    await dialog.getByLabel('Name of Saved').fill('Wishlist');
    await dialog.getByLabel('Name of Saved').press('Enter');
    await expect(dialog.getByLabel('Name of Wishlist')).toHaveValue('Wishlist');
    await dialog.getByPlaceholder('e.g. Take-home task').fill('Take-home');
    await dialog.getByRole('button', { name: 'Add column' }).click();
    await expect(dialog.getByLabel('Name of Take-home')).toBeVisible();
    await dialog.getByRole('button', { name: 'Archive Withdrawn' }).click();
    await expect(dialog.getByText('Archived columns')).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();

    await expect(page.getByRole('region', { name: 'Wishlist column' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Take-home column' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Withdrawn column' })).toBeHidden();
  });

  test('captures a job from a pasted link on Pro', async ({
    context,
    worker,
    extensionId,
    fixtureServer,
  }) => {
    await seedSignedIn(worker, {
      status: 'trialing',
      trialEndsAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      hasBillingAccount: false,
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/board.html`);
    await page.getByRole('button', { name: 'Add job' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a job' });
    await dialog.getByLabel('Job link').fill(fixtureServer.url('sites/greenhouse/board.html'));
    await dialog.getByRole('button', { name: 'Fill in from link' }).click();

    const review = page.getByRole('dialog', { name: 'Check the details' });
    await expect(review.getByLabel('Job title')).toHaveValue('Backend Engineer (Payments)');
    await review.getByRole('button', { name: /^Save to/ }).click();
    await expect(review).toBeHidden();
    await expect(page.getByText('Backend Engineer (Payments)')).toBeVisible();
  });

  test('deleting the account keeps jobs on this device', async ({
    context,
    worker,
    extensionId,
    backend,
  }) => {
    await seedActiveJobs(worker, 2);
    await seedSignedIn(worker, {
      status: 'trialing',
      trialEndsAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      hasBillingAccount: false,
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/board.html#account`);
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Delete account…' }).click();
    await dialog.getByRole('button', { name: 'Delete account', exact: true }).click();
    await expect(dialog.getByText('Start your 30-day Pro trial')).toBeVisible();
    expect(backend.requests.some((r) => r.path === '/functions/v1/delete-account')).toBe(true);
    const keys = await worker.evaluate(async () =>
      Object.keys(await chrome.storage.local.get(null)),
    );
    expect(keys.filter((k) => k.startsWith('job:'))).toHaveLength(2);
    expect(keys.some((k) => k.startsWith('account:'))).toBe(false);
  });
});

test('@smoke the production build has no accounts: no sign-in, no identity permission, no limit', async ({
  context,
  worker,
  extensionId,
  extensionDir,
}) => {
  test.skip(extensionDir.endsWith('-e2e'), 'checks the build without a backend');
  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.permissions).not.toContain('identity');
  await seedActiveJobs(worker, 30);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/board.html`);
  await expect(page.getByText('Role 29')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Account', exact: true })).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Plan notice' })).toHaveCount(0);
});
