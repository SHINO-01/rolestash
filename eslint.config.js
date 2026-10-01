import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '.output',
      '.wxt',
      'coverage',
      'node_modules',
      'playwright-report',
      'test-results',
      'site/board', // built web board (npm run build:web)
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser, ...globals.webextensions },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      // Architectural boundaries — see docs/architecture/overview.md#layering.
      'no-restricted-imports': 'off',
    },
  },
  {
    // The extraction engine, email engine and domain model are pure: no
    // extension APIs, no UI. src/email also runs in a Cloudflare Worker.
    files: [
      'src/extraction/**/*.ts',
      'src/domain/**/*.ts',
      'src/email/**/*.ts',
      'src/autofill/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'wxt/*',
                '#imports',
                '@/platform/*',
                '@/storage/*',
                '@/ui/*',
                '@/features/*',
                'react',
                'react-dom',
              ],
              message:
                'domain/, extraction/, email/ and autofill/ must stay pure (no browser, storage or UI imports). See docs/architecture/overview.md.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'chrome', message: 'Use src/platform adapters instead.' },
        { name: 'browser', message: 'Use src/platform adapters instead.' },
      ],
    },
  },
  {
    // Provider + hook modules intentionally co-locate non-component exports.
    files: ['src/ui/hooks/**', 'src/ui/app-root.tsx', 'src/ui/components/toast.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    files: ['tests/**/*.ts', 'scripts/**/*.ts', '*.config.ts', '*.config.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // Playwright fixtures call `use()`, which is not a React hook.
      'react-hooks/rules-of-hooks': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },
  {
    // The Email Worker logs its outcome (never content) to Workers logs.
    files: ['infra/email-worker/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['*.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // rolestash.com's only script (the checkout page); plain browser JS.
    files: ['site/**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      parserOptions: { projectService: false, project: null },
      globals: { ...globals.browser },
    },
  },
);
