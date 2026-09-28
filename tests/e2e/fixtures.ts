import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, normalize } from 'node:path';
import { chromium, test as base, type BrowserContext, type Worker } from '@playwright/test';

const EXTENSION_PATH = resolve(import.meta.dirname, '../../.output/chrome-mv3-e2e');
const FIXTURES_ROOT = resolve(import.meta.dirname, '../fixtures');

/**
 * Use a system Chromium when PLAYWRIGHT_CHROMIUM_PATH is set (e.g. sandboxes
 * with a pre-installed browser); otherwise Playwright's bundled Chromium.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

interface Fixtures {
  context: BrowserContext;
  worker: Worker;
  extensionId: string;
  fixtureServer: { url: (path: string) => string };
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    if (!existsSync(EXTENSION_PATH)) throw new Error('Run `npm run build:e2e` first.');
    const context = await chromium.launchPersistentContext('', {
      headless: true,
      ...(executablePath ? { executablePath } : {}),
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
    worker ??= await context.waitForEvent('serviceworker');
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
    await use(worker);
  },
  extensionId: async ({ worker }, use) => {
    await use(new URL(worker.url()).host);
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
