import path from 'node:path';
import type { Worker } from '@playwright/test';
import { expect, test } from './fixtures';
import { analyzeEmail } from '../../src/email/analyze';
import { E2E_CODE, E2E_INBOX, MOCK_BACKEND } from './mock-backend';
import { serveBoard } from '../web/serve-board';

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

  test('signs in with an email code and starts the Advanced trial', async ({
    context,
    extensionId,
    backend,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/board.html`);
    await page.getByRole('button', { name: 'Account', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Start your 14-day free trial')).toBeVisible();
    // The mock project enables Google, so the button is offered.
    await expect(dialog.getByRole('button', { name: 'Continue with Google' })).toBeVisible();

    await dialog.getByLabel('Email', { exact: true }).fill('Jo@Example.com');
    await dialog.getByRole('button', { name: 'Email me a sign-in code' }).click();
    await dialog.getByLabel('Sign-in code').fill('000000');
    await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('wrong or has expired');

    await dialog.getByLabel('Sign-in code').fill(E2E_CODE);
    await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(dialog.getByText('Your account', { exact: true })).toBeVisible();
    await expect(dialog.getByText(/Advanced trial: 14 days left/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Account', exact: true })).toContainText(
      'Advanced trial · 14d',
    );

    const otp = backend.requests.find((r) => r.path === '/auth/v1/otp');
    expect(otp?.body).toEqual({ email: 'jo@example.com', create_user: true });
    expect(otp?.headers.apikey).toBe('e2e-anon-key');
    const read = backend.requests.find((r) => r.path === '/rest/v1/entitlements');
    expect(read?.headers.authorization).toBe('Bearer e2e-access');
  });

  test('opting out of shared learning at sign-up, then a name and photo (ADR-0022)', async ({
    context,
    extensionId,
    backend,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/board.html`);
    await page.getByRole('button', { name: 'Account', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const share = dialog.getByRole('checkbox', { name: /Help improve automatic updates/ });
    await expect(share).toBeChecked();
    await share.uncheck();
    await dialog.getByLabel('Email', { exact: true }).fill('jo@example.com');
    await dialog.getByRole('button', { name: 'Email me a sign-in code' }).click();
    await dialog.getByLabel('Sign-in code').fill(E2E_CODE);
    await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(dialog.getByText('Your account', { exact: true })).toBeVisible();
    await expect.poll(() => backend.shareLearning).toBe(false);

    const profile = dialog.getByRole('region', { name: 'Profile' });
    await profile.getByLabel('Display name').fill('Jo Example');
    await profile.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Name saved')).toBeVisible();
    // A 3×2 red PNG: resized on the device to a 128-pixel square before saving.
    await profile.getByLabel('Choose a profile photo').setInputFiles({
      name: 'me.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAEElEQVR4nGP4z8AAQQxwFgBB0gX7h/C5SAAAAABJRU5ErkJggg==',
        'base64',
      ),
    });
    await expect(page.getByText('Photo saved')).toBeVisible();
    expect(backend.profile?.display_name).toBe('Jo Example');
    expect(backend.profile?.avatar).toMatch(/^data:image\/(webp|jpeg);base64,/);
    const header = page.getByRole('button', { name: 'Account', exact: true }).locator('img');
    await expect(header).toHaveAttribute('src', /^data:image\//);
    const size = await header.evaluate((img: HTMLImageElement) => [
      img.naturalWidth,
      img.naturalHeight,
    ]);
    expect(size).toEqual([128, 128]);
  });

  for (const file of ['classic.pdf', 'classic.docx'])
    test(`fills the autofill profile from a résumé on Pro, on this device (${file})`, async ({
      context,
      worker,
      extensionId,
    }) => {
      await seedSignedIn(worker, {
        status: 'trialing',
        trialEndsAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
        hasBillingAccount: false,
      });
      const page = await context.newPage();
      const elsewhere: string[] = [];
      page.on('request', (r) => {
        if (!/^(chrome-extension|blob|data):|^http:\/\/127\.0\.0\.1/.test(r.url()))
          elsewhere.push(r.url());
      });
      await page.goto(`chrome-extension://${extensionId}/board.html#profile`);
      const dialog = page.getByRole('dialog', { name: 'Autofill profile' });
      // What's already there is kept.
      await dialog.getByLabel('Email', { exact: true }).fill('mine@example.com');
      await dialog
        .getByLabel('Choose your résumé')
        .setInputFiles(path.join(import.meta.dirname, '../fixtures/resumes/files', file));
      await expect(page.getByText(/from your résumé\. Check them, then save\./)).toBeVisible();
      await expect(dialog.getByLabel('First name')).toHaveValue('Sam');
      await expect(dialog.getByLabel('Last name')).toHaveValue('Taylor');
      await expect(dialog.getByLabel('Phone')).toHaveValue('+61 400 123 456');
      await expect(dialog.getByLabel('City or suburb')).toHaveValue('Sydney');
      await expect(dialog.getByLabel('Current job title')).toHaveValue('Senior Data Analyst');
      await expect(dialog.getByLabel('Current employer')).toHaveValue('Quokka Health');
      await expect(dialog.getByLabel('LinkedIn URL')).toHaveValue(
        'https://linkedin.com/in/sam-taylor-example',
      );
      await expect(dialog.getByLabel('Email', { exact: true })).toHaveValue('mine@example.com');
      await expect(dialog.getByText('From your résumé: check it').first()).toBeVisible();
      expect(elsewhere).toEqual([]);
    });

  test('switching a paid plan shows what it costs now and changes only on confirm', async ({
    context,
    worker,
    extensionId,
    backend,
  }) => {
    const end = new Date(Date.now() + 20 * 86_400_000).toISOString();
    await seedSignedIn(worker, {
      status: 'active',
      tier: 'pro',
      currentPeriodEnd: end,
      hasBillingAccount: true,
    });
    backend.entitlement = {
      status: 'active',
      tier: 'pro',
      trial_ends_at: null,
      current_period_end: end,
      provider_customer_id: 'ctm_e2e',
    };
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/board.html#account`);
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'US$15 / month' }).click();
    const confirm = dialog.getByRole('group', { name: 'Confirm plan change' });
    await expect(confirm).toContainText('will charge $8.48 now');
    const changes = () => backend.requests.filter((r) => r.path === '/functions/v1/change-plan');
    expect(changes().map((r) => r.body)).toEqual([
      { tier: 'advanced', interval: 'month', preview: true },
    ]);
    // Cancel changes nothing; confirming makes the one real change.
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toHaveCount(0);
    await dialog.getByRole('button', { name: 'US$15 / month' }).click();
    await dialog.getByRole('button', { name: /Pay .*8\.48 and switch/ }).click();
    await expect(page.getByText(/Switched to Advanced\. Paddle charged/)).toBeVisible();
    expect(changes().map((r) => r.body)).toEqual([
      { tier: 'advanced', interval: 'month', preview: true },
      { tier: 'advanced', interval: 'month', preview: true },
      { tier: 'advanced', interval: 'month' },
    ]);
  });

  test('the "Set up autofill" suggestion is slim and can be dismissed for good', async ({
    context,
    worker,
    extensionId,
  }) => {
    await seedSignedIn(worker, {
      status: 'trialing',
      tier: 'advanced',
      trialEndsAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      hasBillingAccount: false,
    });
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 380, height: 800 });
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(panel.getByRole('button', { name: 'Set up autofill' })).toBeVisible();
    await panel.getByRole('button', { name: 'Dismiss autofill suggestion' }).click();
    await expect(panel.getByRole('button', { name: 'Set up autofill' })).toHaveCount(0);
    await panel.reload();
    await expect(panel.getByRole('button', { name: 'Save this page' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Set up autofill' })).toHaveCount(0);
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
    await expect(page.getByRole('dialog')).toContainText('Start your 14-day free trial');
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
    await expect(dialog).toContainText('Your free trial has ended');

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

  test('syncs the board with other devices on Pro', async ({
    context,
    worker,
    extensionId,
    backend,
  }) => {
    await seedActiveJobs(worker, 1); // "Role 0" on this device
    await seedSignedIn(worker, {
      status: 'trialing',
      trialEndsAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      hasBillingAccount: false,
    });
    // A job saved on another computer, already on the server.
    const now = new Date().toISOString();
    backend.synced.set('remote-1', {
      data: {
        id: 'remote-1',
        title: 'Synced from laptop',
        company: 'Harbour Analytics',
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
          url: 'https://example.com/jobs/remote-1',
          originalUrl: 'https://example.com/jobs/remote-1',
          siteId: 'generic',
          siteName: 'example.com',
          capturedAt: now,
        },
      },
      deleted: false,
      updated_at: now,
      revision: ++backend.revision,
    });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/board.html#account`);
    const dialog = page.getByRole('dialog', { name: 'Your account' });
    await dialog.getByRole('button', { name: 'Sync this browser' }).click();
    await expect(dialog.getByRole('list', { name: 'Synced devices' })).toContainText(
      'this browser',
    );
    await dialog.getByRole('button', { name: 'Close' }).click();

    // Pulled: the other device's job is on this board; pushed: ours is on the server.
    await expect(page.getByText('Synced from laptop')).toBeVisible();
    await expect.poll(() => backend.synced.has('j0')).toBe(true);
    expect(backend.devices).toHaveLength(1);
    expect(backend.devices[0]?.kind).toBe('computer');
  });

  test('the web board signs itself in from the extension, without a second sign-in', async ({
    context,
    worker,
    backend,
  }) => {
    backend.entitlement = {
      status: 'active',
      tier: 'advanced',
      trial_ends_at: null,
      current_period_end: new Date(Date.now() + 20 * 86_400_000).toISOString(),
      provider_customer_id: 'ctm_1',
    };
    await seedSignedIn(worker, {
      status: 'active',
      tier: 'advanced',
      currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000).toISOString(),
      hasBillingAccount: true,
    });
    const board = await serveBoard();
    try {
      const page = await context.newPage();
      await page.goto(`${board.origin}/board/`);
      await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
      // The extension minted a single-use token with its own session...
      const minted = backend.requests.find((r) => r.path === '/functions/v1/web-handoff');
      expect(minted?.headers.authorization).toBe('Bearer e2e-access');
      // ...and the board exchanged it for a session of its own.
      expect(
        backend.requests.some(
          (r) => r.path === '/auth/v1/verify' && (r.body as { token_hash?: string }).token_hash,
        ),
      ).toBe(true);

      // Signing out of the board sticks: no automatic sign-in again.
      await page.getByRole('button', { name: 'Account' }).click();
      await page.getByRole('button', { name: 'Sign out and clear this browser' }).click();
      await expect(page.getByRole('heading', { name: 'Your board, on your phone' })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Your board, on your phone' })).toBeVisible();
    } finally {
      await board.close();
    }
  });

  test('email updates move the card, show the interview, undo, and sort the rest', async ({
    context,
    worker,
    extensionId,
    backend,
  }) => {
    const advanced = {
      status: 'active',
      tier: 'advanced',
      currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000).toISOString(),
      hasBillingAccount: false,
    };
    await seedSignedIn(worker, advanced);
    backend.entitlement = {
      status: 'active',
      tier: 'advanced',
      trial_ends_at: null,
      current_period_end: advanced.currentPeriodEnd,
      provider_customer_id: null,
    };
    const posting = 'https://job-boards.greenhouse.io/northwindlabs/jobs/4012345';
    await worker.evaluate(async (url) => {
      const now = new Date().toISOString();
      await chrome.storage.local.set({
        'job:nw': {
          id: 'nw',
          title: 'Data Analyst',
          company: 'Northwind Labs',
          employmentTypes: [],
          stageId: 'applied',
          rank: 1024,
          priority: 0,
          tags: [],
          notes: '',
          activity: [],
          createdAt: now,
          updatedAt: now,
          appliedAt: now,
          source: {
            url,
            originalUrl: url,
            siteId: 'greenhouse',
            siteName: 'Greenhouse',
            capturedAt: now,
          },
        },
      });
    }, posting);
    // What the Email Worker would have stored: an interview invite for the
    // Northwind job, and a rejection that matches no job on this board.
    backend.emailEvents = [
      {
        id: 1,
        event: analyzeEmail({
          from: 'Jordan Lee <jordan@northwindlabs.example>',
          subject: 'Interview invitation - Data Analyst',
          date: new Date().toISOString(),
          html: `<p>We would like to invite you to a video interview on Thursday 9 October 2031 at 10am AEST.</p><p><a href="https://us02web.zoom.us/j/81234567890">Join Zoom</a> <a href="${posting}">The role</a></p>`,
        }),
      },
      {
        id: 2,
        event: analyzeEmail({
          from: 'Quokka Health HR <hr@quokkahealth.example>',
          subject: 'Product Designer application',
          date: new Date().toISOString(),
          text: 'Dear Sam, we are unable to offer you a position at this time.',
        }),
      },
    ];

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/board.html#job=nw`);
    const drawer = page.getByRole('dialog', { name: 'Data Analyst details' });
    await expect(drawer.getByLabel('Column')).toHaveValue('interviewing');
    await expect(drawer.getByRole('link', { name: 'Join' })).toHaveAttribute(
      'href',
      'https://us02web.zoom.us/j/81234567890',
    );
    await expect(drawer.getByRole('button', { name: 'Add to calendar' })).toBeVisible();
    await expect(drawer.getByText('“Interview invitation - Data Analyst”')).toBeVisible();
    // Processed events are deleted from the server.
    await expect.poll(() => backend.emailEvents.length).toBe(0);

    await drawer.getByRole('button', { name: 'Undo' }).click();
    await expect(drawer.getByLabel('Column')).toHaveValue('applied');
    await expect(drawer.getByText('Undone')).toBeVisible();
    await drawer.getByRole('button', { name: 'Close' }).click();

    await page.getByRole('button', { name: 'Unsorted (1)' }).click();
    const unsorted = page.getByRole('dialog', { name: 'Unsorted updates' });
    await expect(unsorted).toContainText('Rejection');
    await unsorted.getByRole('button', { name: 'Add this job' }).click();
    await expect(unsorted).toContainText('All sorted');
    // Filing it taught shared learning which company that sender domain is.
    await expect
      .poll(() => backend.votes)
      .toContainEqual({ kind: 'domain', key: 'quokkahealth.example', value: 'quokka health' });
    await unsorted.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('button', { name: 'Product Designer application' })).toBeVisible();

    await page.goto(`chrome-extension://${extensionId}/board.html#account`);
    await expect(page.getByLabel('Your forwarding address')).toHaveText(E2E_INBOX);
  });

  test('saves the autofill profile on this device (Advanced)', async ({
    context,
    worker,
    extensionId,
    backend,
  }) => {
    const end = new Date(Date.now() + 20 * 86_400_000).toISOString();
    await seedSignedIn(worker, {
      status: 'active',
      tier: 'advanced',
      currentPeriodEnd: end,
      hasBillingAccount: false,
    });
    backend.entitlement = {
      status: 'active',
      tier: 'advanced',
      trial_ends_at: null,
      current_period_end: end,
      provider_customer_id: null,
    };
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/board.html#profile`);
    const dialog = page.getByRole('dialog', { name: 'Autofill profile' });
    await dialog.getByLabel('First name').fill('Sam');
    await dialog.getByLabel('Email', { exact: true }).fill('sam@example.com');
    await dialog.getByLabel('Need visa sponsorship?').selectOption('no');
    await dialog.getByRole('button', { name: 'Add a saved answer' }).click();
    await dialog.getByLabel('Question 1').fill('Why do you want to work here?');
    await dialog.getByLabel('Answer 1').fill('The mission.');
    await dialog.getByRole('button', { name: 'Save profile' }).click();
    await expect(dialog).toBeHidden();
    const stored = await worker.evaluate(
      async () => (await chrome.storage.local.get('profile')).profile,
    );
    expect(stored).toMatchObject({
      firstName: 'Sam',
      email: 'sam@example.com',
      needsSponsorship: 'no',
      answers: [{ question: 'Why do you want to work here?', answer: 'The mission.' }],
    });
    // It never leaves the device: no request carries it.
    expect(JSON.stringify(backend.requests)).not.toContain('sam@example.com');
  });

  test('contacts, interview rounds and documents on a card, and the calendar export (Advanced)', async ({
    context,
    worker,
    extensionId,
    backend,
  }) => {
    const end = new Date(Date.now() + 20 * 86_400_000).toISOString();
    await seedActiveJobs(worker, 1);
    await seedSignedIn(worker, {
      status: 'active',
      tier: 'advanced',
      currentPeriodEnd: end,
      hasBillingAccount: false,
    });
    backend.entitlement = {
      status: 'active',
      tier: 'advanced',
      trial_ends_at: null,
      current_period_end: end,
      provider_customer_id: null,
    };
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/board.html#job=j0`);
    const drawer = page.getByRole('dialog', { name: 'Role 0 details' });

    await drawer.getByRole('button', { name: 'Add an interview round' }).click();
    const roundForm = drawer.getByRole('form', { name: 'Interview round' });
    await roundForm.getByLabel('When').fill('2031-10-09T10:00');
    await roundForm.getByLabel('With').fill('Priya');
    await roundForm.getByLabel('Notes').fill('Asked about SQL window functions');
    await roundForm.getByRole('button', { name: 'Save' }).click();
    await expect(drawer.getByRole('list', { name: 'Interview rounds' })).toContainText(
      'Asked about SQL',
    );

    await drawer.getByRole('button', { name: 'Add a contact' }).click();
    const contactForm = drawer.getByRole('form', { name: 'Contact' });
    await contactForm.getByLabel('Name').fill('Jordan Lee');
    await contactForm.getByLabel('Email', { exact: true }).fill('jordan@harbour.example');
    await contactForm.getByRole('button', { name: 'Save' }).click();
    await expect(drawer.getByRole('link', { name: 'jordan@harbour.example' })).toHaveAttribute(
      'href',
      'mailto:jordan@harbour.example',
    );

    await drawer.getByRole('button', { name: 'Add a document' }).click();
    const docForm = drawer.getByRole('form', { name: 'Document' });
    await docForm.getByLabel('File name').fill('Resume-2031.pdf');
    await docForm.getByRole('button', { name: 'Save' }).click();
    await expect(drawer.getByRole('list', { name: 'Documents' })).toContainText('Resume-2031.pdf');

    const stored = await worker.evaluate(
      async () => (await chrome.storage.local.get('job:j0'))['job:j0'],
    );
    expect(stored).toMatchObject({
      rounds: [{ kind: 'video', with: 'Priya' }],
      contacts: [{ name: 'Jordan Lee', email: 'jordan@harbour.example' }],
      documents: [{ kind: 'resume', name: 'Resume-2031.pdf' }],
    });

    await drawer.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Board menu' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Export calendar (.ics)' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^rolestash-calendar-.*\.ics$/);
    const ics = await (await import('node:fs/promises')).readFile(await file.path(), 'utf8');
    expect(ics).toContain('SUMMARY:Video interview: Role 0 at Acme');
    expect(ics).not.toContain('SQL');
  });

  test('on Free, saved records stay but adding new ones is offered as Pro', async ({
    context,
    worker,
    extensionId,
  }) => {
    await seedActiveJobs(worker, 1);
    await worker.evaluate(async () => {
      const job = (await chrome.storage.local.get('job:j0'))['job:j0'] as Record<string, unknown>;
      await chrome.storage.local.set({
        'job:j0': { ...job, contacts: [{ id: 'c', name: 'Kept Contact' }] },
      });
    });
    await seedSignedIn(worker, {
      status: 'expired',
      hasBillingAccount: false,
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/board.html#job=j0`);
    const drawer = page.getByRole('dialog', { name: 'Role 0 details' });
    await expect(drawer.getByText('Kept Contact')).toBeVisible();
    await expect(drawer.getByText('Adding these is part of Pro.').first()).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Add a contact' })).toHaveCount(0);
  });

  test('the side panel: Today and a job on Advanced, save and a pitch on Pro (ADR-0021)', async ({
    context,
    worker,
    extensionId,
    backend,
  }) => {
    const end = new Date(Date.now() + 20 * 86_400_000).toISOString();
    await seedActiveJobs(worker, 1);
    await worker.evaluate(async () => {
      const job = (await chrome.storage.local.get('job:j0'))['job:j0'] as Record<string, unknown>;
      await chrome.storage.local.set({
        'job:j0': { ...job, followUpAt: new Date().toISOString() },
      });
    });
    await seedSignedIn(worker, {
      status: 'active',
      tier: 'advanced',
      currentPeriodEnd: end,
      hasBillingAccount: false,
    });
    backend.entitlement = {
      status: 'active',
      tier: 'advanced',
      trial_ends_at: null,
      current_period_end: end,
      provider_customer_id: null,
    };
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 380, height: 800 });
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(panel.getByRole('button', { name: 'Save this page' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Today', pressed: true })).toBeVisible();
    await panel
      .getByRole('button', { name: /Role 0/ })
      .first()
      .click();
    await expect(panel.getByRole('dialog', { name: 'Role 0 details' })).toBeVisible();
    // The panel itself can't be saved; it says how to give access.
    await panel
      .getByRole('dialog', { name: 'Role 0 details' })
      .getByRole('button', { name: 'Close' })
      .click();
    await panel.getByRole('button', { name: 'Save this page' }).click();
    await expect(panel.getByText(/click the Rolestash icon/)).toBeVisible();

    await seedSignedIn(worker, {
      status: 'trialing',
      tier: 'pro',
      trialEndsAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      hasBillingAccount: false,
    });
    await panel.reload();
    await expect(panel.getByText('Your whole board, right here')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Today' })).toHaveCount(0);
  });

  test('the board can make the toolbar icon open the side panel (ADR-0021)', async ({
    context,
    worker,
    extensionId,
  }) => {
    await seedActiveJobs(worker, 1);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/board.html`);
    await page.getByRole('button', { name: 'Board menu' }).click();
    await page.getByRole('menuitem', { name: 'Toolbar icon opens the side panel' }).click();
    await expect(page.getByText('now opens the side panel')).toBeVisible();
    const behaviour = await worker.evaluate(async () => ({
      popup: await chrome.action.getPopup({}),
      title: await chrome.action.getTitle({}),
      panel: (await chrome.sidePanel.getPanelBehavior()).openPanelOnActionClick,
      setting: (
        (await chrome.storage.local.get('settings')).settings as { iconOpensPanel?: boolean }
      ).iconOpensPanel,
    }));
    expect(behaviour).toEqual({
      popup: '',
      title: 'Rolestash: open the side panel',
      panel: true,
      setting: true,
    });
  });

  test('insights: applications per week, how far they get, replies and sources (Advanced)', async ({
    context,
    worker,
    extensionId,
    backend,
  }) => {
    const end = new Date(Date.now() + 20 * 86_400_000).toISOString();
    await seedSignedIn(worker, {
      status: 'active',
      tier: 'advanced',
      currentPeriodEnd: end,
      hasBillingAccount: false,
    });
    backend.entitlement = {
      status: 'active',
      tier: 'advanced',
      trial_ends_at: null,
      current_period_end: end,
      provider_customer_id: null,
    };
    await worker.evaluate(async () => {
      const day = 86_400_000;
      const ago = (d: number) => new Date(Date.now() - d * day).toISOString();
      const entries: Record<string, unknown> = {};
      const sites = ['SEEK', 'LinkedIn', 'Greenhouse'];
      for (let i = 0; i < 14; i++) {
        const applied = ago(i * 5 + 1);
        const replied = i % 3 === 0;
        entries[`job:i${String(i)}`] = {
          id: `i${String(i)}`,
          title: `Role ${String(i)}`,
          company: 'Acme',
          employmentTypes: [],
          stageId: replied ? (i === 0 ? 'offer' : 'interviewing') : 'applied',
          rank: 1024 * (i + 1),
          priority: 0,
          tags: [],
          notes: '',
          appliedAt: applied,
          activity: replied
            ? [
                {
                  id: `m${String(i)}`,
                  at: ago(i * 5),
                  type: 'stage_changed',
                  fromStageId: 'applied',
                  toStageId: 'interviewing',
                },
              ]
            : [],
          createdAt: applied,
          updatedAt: applied,
          source: {
            url: `https://example.com/jobs/${String(i)}`,
            originalUrl: `https://example.com/jobs/${String(i)}`,
            siteId: 'generic',
            siteName: sites[i % 3],
            capturedAt: applied,
          },
        };
      }
      await chrome.storage.local.set(entries);
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/board.html`);
    await page.getByRole('button', { name: 'Insights' }).click();
    const dialog = page.getByRole('dialog', { name: 'Insights' });
    await expect(dialog.getByText('Got a reply')).toBeVisible();
    await expect(dialog.getByText('5 of 14')).toBeVisible();
    await expect(
      dialog.getByRole('img', { name: 'Applications per week, last 12 weeks' }),
    ).toBeVisible();
    await expect(dialog.getByRole('row', { name: /SEEK/ })).toBeVisible();
    await dialog
      .getByRole('img', { name: 'Applications per week, last 12 weeks' })
      .locator('rect')
      .last()
      .hover();
    await expect(dialog.getByRole('tooltip')).toContainText('Week of');
    // Where applications end up: Applications → Interviewing → Offer, the rest still waiting.
    const paths = dialog.getByRole('img', { name: 'Where applications end up' });
    await expect(paths).toBeVisible();
    await page.mouse.move(0, 0);
    await paths.locator('[aria-label="Applications to Interviewing: 5"]').focus();
    await expect(dialog.getByRole('tooltip')).toContainText('Applications → Interviewing: 5');
  });

  test('bulk actions: select, move, tag, delete and undo (Advanced)', async ({
    context,
    worker,
    extensionId,
    backend,
  }) => {
    const end = new Date(Date.now() + 20 * 86_400_000).toISOString();
    await seedActiveJobs(worker, 3);
    await seedSignedIn(worker, {
      status: 'active',
      tier: 'advanced',
      currentPeriodEnd: end,
      hasBillingAccount: false,
    });
    backend.entitlement = {
      status: 'active',
      tier: 'advanced',
      trial_ends_at: null,
      current_period_end: end,
      provider_customer_id: null,
    };
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/board.html`);
    const card = (n: number) => page.getByRole('button', { name: `Role ${String(n)} at Acme` });

    await page.getByRole('button', { name: 'Select' }).click();
    await card(0).click();
    await card(2).click();
    const bar = page.getByRole('toolbar', { name: 'Bulk actions' });
    await expect(bar).toContainText('2 selected');
    await bar.getByLabel('Move to').selectOption({ label: 'Applied' });
    await expect(page.getByText('Moved 2 jobs to Applied')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Applied column' })).toContainText('Role 0');
    await expect(page.getByRole('region', { name: 'Applied column' })).toContainText('Role 2');
    await expect(bar).toBeHidden();

    // Ctrl-click selects without select mode.
    await card(1).click({ modifiers: ['Control'] });
    await card(2).click({ modifiers: ['Control'] });
    await bar.getByRole('button', { name: 'Add tag' }).click();
    await bar.getByLabel('Tag').fill('shortlist');
    await bar.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('Tagged 2 jobs #shortlist')).toBeVisible();
    const tags = await worker.evaluate(async () => {
      const all = await chrome.storage.local.get(['job:j1', 'job:j2']);
      return [all['job:j1'], all['job:j2']].map((j) => (j as { tags: string[] }).tags);
    });
    expect(tags).toEqual([['shortlist'], ['shortlist']]);

    await card(1).click({ modifiers: ['Control'] });
    await bar.getByRole('button', { name: 'Delete' }).click();
    await expect(card(1)).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(card(1)).toBeVisible();
  });

  test('on Free, selecting several jobs is offered as Pro', async ({
    context,
    worker,
    extensionId,
  }) => {
    await seedActiveJobs(worker, 2);
    await seedSignedIn(worker, {
      status: 'expired',
      hasBillingAccount: false,
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/board.html`);
    await page.getByRole('button', { name: 'Select' }).click();
    await expect(page.getByText('Selecting several jobs at once is part of Pro.')).toBeVisible();
    await page.getByRole('button', { name: 'Role 0 at Acme' }).click({ modifiers: ['Control'] });
    await expect(page.getByRole('toolbar', { name: 'Bulk actions' })).toHaveCount(0);
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
    await expect(dialog.getByText('Start your 14-day free trial')).toBeVisible();
    expect(backend.requests.some((r) => r.path === '/functions/v1/delete-account')).toBe(true);
    const keys = await worker.evaluate(async () =>
      Object.keys(await chrome.storage.local.get(null)),
    );
    expect(keys.filter((k) => k.startsWith('job:'))).toHaveLength(2);
    expect(keys.some((k) => k.startsWith('account:'))).toBe(false);
  });
});

/**
 * The release build ships with accounts off until launch, then on (the
 * release repo sets the backend variables). These smoke tests check whichever
 * the build is, so both pass in the release pipeline.
 */
const accountsOn = (manifest: chrome.runtime.Manifest) =>
  (manifest.permissions ?? []).includes('identity');

test('@smoke the production build: accounts exactly as configured', async ({
  context,
  worker,
  extensionId,
  extensionDir,
}) => {
  test.skip(extensionDir.endsWith('-e2e'), 'checks the release build');
  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  const raw = manifest as unknown as Record<string, unknown>;
  // Never a pinned development key, never a localhost board.
  expect(raw.key).toBeUndefined();
  await seedActiveJobs(worker, 30);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/board.html`);
  await expect(page.getByText('Role 29')).toBeVisible();
  if (accountsOn(manifest)) {
    expect(raw.externally_connectable).toEqual({ matches: ['https://rolestash.com/board/*'] });
    await expect(page.getByRole('button', { name: 'Account', exact: true })).toContainText(
      'Sign in',
    );
  } else {
    expect(raw.externally_connectable).toBeUndefined();
    await expect(page.getByRole('button', { name: 'Account', exact: true })).toHaveCount(0);
    await expect(page.getByRole('status', { name: 'Plan notice' })).toHaveCount(0);
  }
});

test('@smoke the production build: Insights, bulk actions and the side panel for its mode', async ({
  context,
  worker,
  extensionId,
  extensionDir,
}) => {
  test.skip(extensionDir.endsWith('-e2e'), 'checks the release build');
  const on = accountsOn(await worker.evaluate(() => chrome.runtime.getManifest()));
  await seedActiveJobs(worker, 3);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/board.html`);

  // Without accounts nothing is limited; signed out with accounts is Free.
  await page.getByRole('button', { name: 'Insights' }).click();
  const insights = page.getByRole('dialog', { name: 'Insights' });
  if (on) await expect(insights.getByText(/Insights are part of Pro/)).toBeVisible();
  else {
    await expect(insights.getByText(/Insights appear once you/)).toBeVisible();
    await expect(insights.getByRole('button', { name: 'See plans' })).toHaveCount(0);
  }
  await insights.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Select' }).click();
  if (on) {
    await expect(page.getByText('Selecting several jobs at once is part of Pro.')).toBeVisible();
  } else {
    await page.getByRole('button', { name: 'Role 0 at Acme' }).click();
    await expect(page.getByRole('toolbar', { name: 'Bulk actions' })).toContainText('1 selected');
    await expect(page.getByText(/part of (Pro|Advanced)/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Account', exact: true })).toHaveCount(0);
  }
  await expect(page.getByText(/forwarding address/i)).toHaveCount(0);

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 380, height: 800 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.getByRole('button', { name: 'Save this page' })).toBeVisible();
  if (on) {
    await expect(panel.getByText('Your whole board, right here')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Today' })).toHaveCount(0);
  } else {
    await expect(panel.getByRole('button', { name: 'Today' })).toBeVisible();
    await expect(panel.getByText('Your whole board, right here')).toHaveCount(0);
    await expect(panel.getByText(/sign in/i)).toHaveCount(0);
  }
});
