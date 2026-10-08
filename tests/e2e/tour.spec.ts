import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures';

/** A fresh install as far as the guides know: neither has run, and E2E lets them open. */
async function firstRun(worker: Worker) {
  await worker.evaluate(async () => {
    await chrome.storage.local.remove(['tour:board', 'tour:widget']);
    await chrome.storage.local.set({ 'tour:e2eAutoStart': true });
  });
}

const storedJobs = (worker: Worker) =>
  worker.evaluate(async () =>
    Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith('job:')),
  );

/** The tour's card (non-modal, so it never hides the page from assistive tech). */
const tourCard = (page: Page) => page.locator('[role="dialog"][aria-modal="false"]');

test.describe('the guided tour (ADR-0039)', () => {
  test('opens on first run, has hands-on steps, and leaves no practice card behind', async ({
    context,
    worker,
    extensionId,
  }) => {
    await firstRun(worker);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`chrome-extension://${extensionId}/board.html`);
    const card = tourCard(page);
    await expect(card.getByRole('heading', { name: 'Welcome to Rolestash' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Skip tour' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Close tour' })).toBeVisible();

    await card.getByRole('button', { name: 'Start the tour' }).click();
    // Next until the board itself (the pin step depends on the toolbar).
    const lanes = card.getByRole('heading', { name: 'One lane for each step' });
    for (let i = 0; i < 3 && !(await lanes.isVisible()); i++)
      await card.getByRole('button', { name: 'Next' }).click();
    await expect(lanes).toBeVisible();
    // The practice card is a real card in the first lane.
    const practice = page.getByRole('button', { name: /Practice job at Rolestash tour/ });
    await expect(
      page.getByRole('region', { name: 'Saved column' }).getByText('Practice job'),
    ).toBeVisible();
    await card.getByRole('button', { name: 'Next' }).click();

    // Hands-on: drag it to Applied, and the tour moves on by itself.
    await expect(card.getByText('Try it: drag the practice card to Applied')).toBeVisible();
    const target = page.getByRole('region', { name: 'Applied column' });
    const from = await practice.boundingBox();
    const to = await target.boundingBox();
    if (!from || !to) throw new Error('layout not ready');
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 20, from.y + 20, { steps: 5 });
    await page.mouse.move(to.x + to.width / 2, to.y + 120, { steps: 15 });
    await page.mouse.up();
    await expect(card.getByText('Nice, that’s it.')).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Open a card for the details' })).toBeVisible();

    // Hands-on: open it; the tour follows into the drawer.
    await practice.click();
    await expect(page.getByRole('dialog', { name: 'Practice job details' })).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Everything about one job' })).toBeVisible();

    // Esc closes the tour, the drawer it opened, and the practice card.
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    await expect(page.getByText('Tour closed. Replay it any time from Help (?).')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Practice job details' })).toHaveCount(0);
    await expect.poll(() => storedJobs(worker)).toEqual([]);
    const record = await worker.evaluate(
      async () => (await chrome.storage.local.get('tour:board'))['tour:board'],
    );
    expect(record).toMatchObject({ status: 'skipped', step: 'card' });

    // It doesn't come back by itself, and Help replays it.
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Your board is ready for its first job' }),
    ).toBeVisible();
    await expect(card).toHaveCount(0);
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Take the tour' }).click();
    await expect(card.getByRole('heading', { name: 'Welcome to Rolestash' })).toBeVisible();
    await card.getByRole('button', { name: 'Skip tour' }).click();
    await expect(card).toHaveCount(0);
    expect(await storedJobs(worker)).toEqual([]);
  });

  test('runs to the end with Next, then removes the practice card', async ({
    context,
    worker,
    extensionId,
  }) => {
    await firstRun(worker);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`chrome-extension://${extensionId}/board.html`);
    const card = tourCard(page);
    await card.getByRole('button', { name: 'Start the tour' }).click();
    const finish = card.getByRole('button', { name: 'Finish' });
    // "Skip step" on the hands-on steps, "Next" elsewhere; the drawer opens and closes with them.
    for (let i = 0; i < 20 && !(await finish.isVisible()); i++)
      await card.getByRole('button', { name: /^(Next|Skip step)/ }).click();
    await expect(card.getByRole('heading', { name: 'You’re ready' })).toBeVisible();
    await finish.click();
    await expect(card).toHaveCount(0);
    await expect.poll(() => storedJobs(worker)).toEqual([]);
    const record = await worker.evaluate(
      async () => (await chrome.storage.local.get('tour:board'))['tour:board'],
    );
    expect(record).toMatchObject({ status: 'finished' });
  });

  test('lists the keyboard shortcuts under Help', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/board.html`);
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click();
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dialog.getByText('Search the board')).toBeVisible();
    await expect(dialog.getByText('Open the Save job panel on any page')).toBeVisible();
  });

  test('the widget shows a short guide once, which can be closed', async ({
    context,
    worker,
    fixtureServer,
  }) => {
    await firstRun(worker);
    const page = await context.newPage();
    await page.goto(fixtureServer.url('sites/greenhouse/board.html'));
    await page.getByRole('button', { name: 'Open Rolestash' }).click();
    const widget = page.frameLocator('iframe[title="Rolestash"]');
    const guide = widget.getByRole('region', { name: 'Quick guide' });
    await expect(guide.getByText('This is the job on this page')).toBeVisible();
    await guide.getByRole('button', { name: 'Next' }).click();
    await expect(guide.getByText('Pick a lane')).toBeVisible();
    await guide.getByRole('button', { name: 'Close guide' }).click();
    await expect(guide).toHaveCount(0);

    await widget.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Open Rolestash' }).click();
    await expect(widget.getByRole('button', { name: 'Save job' })).toBeVisible();
    await expect(widget.getByRole('region', { name: 'Quick guide' })).toHaveCount(0);
  });
});
