import { defineConfig } from '@playwright/test';

/**
 * E2E tests load the real extension build (`npm run build:e2e`) into
 * Chromium. See docs/guides/testing.md.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
  },
});
