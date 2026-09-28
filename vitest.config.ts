import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/entrypoints/**', 'src/**/*.d.ts'],
      reporter: ['text-summary', 'html'],
      // UI is covered by E2E; the pure core must stay well unit-tested.
      thresholds: {
        'src/{domain,extraction,storage,services}/**': { lines: 85, branches: 70, functions: 75 },
      },
    },
  },
});
