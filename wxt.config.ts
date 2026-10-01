import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
import { defineConfig } from 'wxt';

/**
 * WXT configuration. See docs/architecture/overview.md for how entrypoints map
 * to extension surfaces, and docs/reference/permissions.md for the rationale
 * behind every permission requested here.
 */
/**
 * Public key that pins the extension ID to bdajnmkjahhphadpdbbkibljcheonejp in
 * development, staging and E2E builds (ADR-0012), so sign-in can allow exactly
 * that ID. Public by design; no private key exists. Production builds omit it:
 * the Chrome Web Store assigns the published ID.
 */
export const DEV_EXTENSION_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvmfatFCkPr8zgup03WO+Ts468OzApR71YxQRoScBfP0Vxa/qBcWUt99cZJPZDB8o7lGpuYADqJnWVyTDYKaBN9H0snC2pGfsEPABqtZxG3JZcFUIngEMzLNvL+t0vWZ9OyL4bK8IgINfHhmXj4J+GGj1oxJGDbdcr+NUnW/7muvIgxnqiBhzZ6Ft6wWhXuGI4oZSS4HMbudBfpIz60R1pF/EF1U33s57a5hdmgr2LNSs2nHfQPwVcqNIteN5ZkWZIBUOxdNy35tGmiLOyqbcXURfN+IX7XCyxLVwVuSQ+olK7NkgmDWlvPGYQhlf1qdOpATbELFbMwzIFK1+r1Ze2QIDAQAB';

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
      ...(mode === 'production' ? {} : { key: DEV_EXTENSION_KEY }),
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
        // Wakes the worker every 15 minutes to check follow-up reminders (ADR-0015). No install warning.
        'alarms',
        // Google sign-in via chrome.identity.launchWebAuthFlow; accounts builds only.
        ...(accounts ? ['identity'] : []),
      ],
      // E2E builds need host access so Playwright can inject into fixture pages
      // without a real user gesture. Production builds never ship this.
      // Asked for only when someone turns reminders on, so there's no install warning (ADR-0015).
      optional_permissions: ['notifications'],
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
