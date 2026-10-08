import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, normalize } from 'node:path';
import { chromium, test as base, type BrowserContext, type Worker } from '@playwright/test';
import { startMockBackend, type MockBackend } from './mock-backend';

const FIXTURES_ROOT = resolve(import.meta.dirname, '../fixtures');

/**
 * Extensions need full Chromium: Playwright's default headless build
 * (chromium-headless-shell) cannot load them, so we use the `chromium` channel
 * (new headless mode). Set PLAYWRIGHT_CHROMIUM_PATH to use a system Chromium.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

/** Set per Playwright project (see playwright.config.ts). */
export interface Options {
  /** Build directory relative to the repo root, e.g. `.output/chrome-mv3`. */
  extensionDir: string;
}

interface Fixtures {
  context: BrowserContext;
  worker: Worker;
  extensionId: string;
  fixtureServer: { url: (path: string) => string };
  /** Mock Supabase for account tests (E2E builds point at it via .env.e2e). */
  backend: MockBackend;
}

export const test = base.extend<Fixtures & Options>({
  extensionDir: ['.output/chrome-mv3-e2e', { option: true }],
  context: async ({ extensionDir }, use) => {
    const EXTENSION_PATH = resolve(import.meta.dirname, '../..', extensionDir);
    if (!existsSync(EXTENSION_PATH))
      throw new Error(`No build at ${extensionDir}; build it first.`);
    const context = await chromium.launchPersistentContext('', {
      headless: true,
      ...(executablePath ? { executablePath } : { channel: 'chromium' }),
      args: [
        '--headless=new',
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    });
    await use(context);
    await context.close();
  },
  worker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    worker ??= await context
      .waitForEvent('serviceworker', { timeout: 10_000 })
      .catch((error: unknown) => {
        throw new Error(
          'The extension service worker did not start. Is the browser a full Chromium build?',
          { cause: error },
        );
      });
    // The worker can be reachable a moment before extension APIs are bound.
    await base.expect
      .poll(
        () =>
          worker.evaluate(() => {
            try {
              return typeof chrome.storage.local;
            } catch {
              return 'not-ready';
            }
          }),
        { timeout: 10_000 },
      )
      .toBe('object');
    // The guided tour and the widget's guide open by themselves in release
    // builds (ADR-0039) and would cover what tests click. Tour tests clear these.
    await worker.evaluate(() => {
      const seen = { status: 'skipped', at: new Date().toISOString() };
      return chrome.storage.local.set({ 'tour:board': seen, 'tour:widget': seen });
    });
    await use(worker);
  },
  extensionId: async ({ worker }, use) => {
    await use(new URL(worker.url()).host);
  },
  // eslint-disable-next-line no-empty-pattern
  backend: async ({}, use) => {
    const backend = await startMockBackend();
    await use(backend);
    await backend.close();
  },
  // eslint-disable-next-line no-empty-pattern
  fixtureServer: async ({}, use) => {
    const server: Server = createServer((req, res) => {
      const path = normalize(
        join(FIXTURES_ROOT, decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/')),
      );
      if (!path.startsWith(FIXTURES_ROOT)) {
        res.writeHead(403).end();
        return;
      }
      readFile(path)
        .then((body) =>
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body),
        )
        .catch(() => res.writeHead(404).end());
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    await use({ url: (path) => `http://127.0.0.1:${port}/${path}` });
    server.closeAllConnections(); // Chromium keeps connections alive
    await new Promise((r) => server.close(r));
  },
});

export const expect = test.expect;
