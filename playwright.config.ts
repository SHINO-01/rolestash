import { defineConfig } from '@playwright/test';
import type { Options } from './tests/e2e/fixtures';

/**
 * Two projects over one spec suite (see docs/guides/testing.md):
 *  - e2e:   everything, against the test build (`npm run test:e2e`)
 *  - smoke: tests tagged @smoke, against the real production build that ships
 *           (`npm run test:smoke`, also run by the jobtrail-extension release pipeline)
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
  ],
});
