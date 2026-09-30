import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
import { defineConfig } from 'wxt';

/**
 * WXT configuration. See docs/architecture/overview.md for how entrypoints map
 * to extension surfaces, and docs/reference/permissions.md for the rationale
 * behind every permission requested here.
 */
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: ({ mode }) => {
    // Accounts are on only when the build has backend settings (ADR-0011).
    const env = loadEnv(mode, process.cwd(), 'WXT_');
    const accounts = Boolean(env.WXT_SUPABASE_URL && env.WXT_SUPABASE_ANON_KEY);
    return {
      name: 'Rolestash — Job Application Tracker',
      short_name: 'Rolestash',
      description:
        'Save any job posting to a local Kanban board in one click. No AI, no accounts, no servers.',
      minimum_chrome_version: '116',
      permissions: [
        // Read the current tab only after an explicit user gesture (popup, menu, shortcut).
        'activeTab',
        // Inject the extractor into that tab on demand.
        'scripting',
        // Local persistence; unlimitedStorage lifts the 10 MB quota for description snapshots.
        'storage',
        'unlimitedStorage',
        // "Track this job" in the page right-click menu.
        'contextMenus',
        // Google sign-in via chrome.identity.launchWebAuthFlow; accounts builds only.
        ...(accounts ? ['identity'] : []),
      ],
      // E2E builds need host access so Playwright can inject into fixture pages
      // without a real user gesture. Production builds never ship this.
      ...(mode === 'e2e' ? { host_permissions: ['<all_urls>'] } : {}),
      action: {
        default_title: 'Track this job',
      },
      commands: {
        _execute_action: {
          suggested_key: { default: 'Alt+J' },
          description: 'Open Rolestash on the current page',
        },
        'track-current-tab': {
          suggested_key: { default: 'Alt+Shift+J' },
          description: 'Save the current job posting straight to the board',
        },
      },
    };
  },
});
