import { defineConfig } from '@playwright/test';
import type { Options } from './tests/e2e/fixtures';

/**
 * Two projects over one spec suite (see docs/guides/testing.md):
 *  - e2e:   everything, against the test build (`npm run test:e2e`)
 *  - smoke: tests tagged @smoke, against the real production build that ships
 *           (`npm run test:smoke`, also run by the rolestash-extension release pipeline)
 *  - perf:  the opt-in board performance probe (`npm run perf:board`)
 *  - clips: records the homepage feature clips (`npm run site:clips`)
 */
export default defineConfig<Options>({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'e2e', use: { extensionDir: '.output/chrome-mv3-e2e' } },
    { name: 'smoke', grep: /@smoke/, use: { extensionDir: '.output/chrome-mv3' } },
    { name: 'perf', testDir: 'tests/perf', use: { extensionDir: '.output/chrome-mv3' } },
    // The web board (ADR-0017) in a plain browser: `npm run build:web:e2e` first.
    { name: 'web', testDir: 'tests/web', use: { channel: 'chromium' } },
    { name: 'clips', testDir: 'tests/clips', use: { extensionDir: '.output/chrome-mv3-e2e' } },
  ],
});
