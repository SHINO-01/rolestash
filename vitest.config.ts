import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    globals: true,
    environment: 'happy-dom',
    // Tests must never touch the network: parse HTML without loading resources.
    environmentOptions: {
      happyDOM: {
        settings: {
          disableCSSFileLoading: true,
          disableJavaScriptFileLoading: true,
          disableIframePageLoading: true,
          handleDisabledFileLoadingAsSuccess: true,
        },
      },
    },
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/entrypoints/**', 'src/**/*.d.ts'],
      reporter: ['text-summary', 'html'],
      // Gate: the pure core (everything except UI and browser adapters, which
      // the E2E suite covers) must keep ≥90% line/statement/function coverage.
      // Branches start at 80% and should only ever be ratcheted up.
      thresholds: {
        'src/{domain,extraction,storage,services}/**': {
          lines: 90,
          statements: 90,
          functions: 90,
          branches: 80,
        },
      },
    },
  },
});
