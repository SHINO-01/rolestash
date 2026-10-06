import { browser } from 'wxt/browser';
import { JOB_SITE_MATCHES } from '@/extraction/adapters/job-sites';
import { WIDGET_ALL_SITES_KEY } from '@/features/capture/widget-protocol';

/**
 * "Show the button on all sites" (ADR-0033). The button is on the supported
 * job sites by default (the manifest's content script and host access). All
 * other sites are optional host access: once the user grants it, the same
 * script is registered for every page (minus the job sites, which already
 * have it); taking it back unregisters it.
 */
export const ALL_SITES: string[] = ['https://*/*', 'http://*/*'];
const SCRIPT_ID = 'rolestash-launcher-all-sites';

export function allSitesGranted(): Promise<boolean> {
  return browser.permissions.contains({ origins: ALL_SITES });
}

/** Makes the registered script and the stored flag match the granted access. */
export async function syncAllSites(): Promise<boolean> {
  const on = await allSitesGranted();
  const registered = await browser.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (on && registered.length === 0)
    await browser.scripting.registerContentScripts([
      {
        id: SCRIPT_ID,
        matches: ALL_SITES,
        excludeMatches: [...JOB_SITE_MATCHES],
        js: ['content-scripts/launcher.js'],
        runAt: 'document_idle',
        persistAcrossSessions: true,
      },
    ]);
  if (!on && registered.length > 0)
    await browser.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  await browser.storage.local.set({ [WIDGET_ALL_SITES_KEY]: on });
  return on;
}

/**
 * Turns all sites on (Chrome asks the user; must run inside a click in an
 * extension page) or off. Resolves with the resulting state.
 */
export async function setAllSites(on: boolean): Promise<boolean> {
  if (on) {
    if (!(await browser.permissions.request({ origins: ALL_SITES }))) return false;
  } else await browser.permissions.remove({ origins: ALL_SITES }).catch(() => false);
  return syncAllSites();
}
