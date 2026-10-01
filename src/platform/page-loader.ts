import { browser } from 'wxt/browser';
import type { PageLoader } from '@/services/ports';
import { ScriptingExtractorRunner } from './extractor-runner';

/**
 * Loads pasted job links for LinkCaptureService. Needs host access to the
 * link's site, granted per site at the moment of use (requestSiteAccess).
 */
const FETCH_TIMEOUT_MS = 15_000;
const RENDER_TIMEOUT_MS = 20_000;
/** Time for client-side rendering after the load event. */
const SETTLE_MS = 1_500;
const MAX_HTML = 5_000_000;

export class ChromePageLoader implements PageLoader {
  async fetch(url: string): Promise<{ url: string; html: string }> {
    const response = await fetch(url, {
      credentials: 'omit',
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'text/html,application/xhtml+xml' },
    });
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
    if (!/html/i.test(response.headers.get('content-type') ?? 'text/html'))
      throw new Error('Not an HTML page');
    const html = await response.text();
    return { url: response.url || url, html: html.slice(0, MAX_HTML) };
  }

  async render(url: string) {
    const tab = await browser.tabs.create({ url, active: false });
    const tabId = tab.id;
    if (tabId === undefined) return [];
    try {
      await waitForLoad(tabId);
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      return await new ScriptingExtractorRunner().run(tabId);
    } finally {
      await browser.tabs.remove(tabId).catch(() => undefined);
    }
  }
}

function waitForLoad(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      browser.tabs.onUpdated.removeListener(listener);
      reject(new Error('The page took too long to load.'));
    }, RENDER_TIMEOUT_MS);
    const listener = (id: number, info: { status?: string }) => {
      if (id !== tabId || info.status !== 'complete') return;
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    browser.tabs.onUpdated.addListener(listener);
  });
}

const originPattern = (url: string) => `${new URL(url).origin}/*`;

/** Asks for access to one site. Must run inside a click in an extension page. */
export function requestSiteAccess(url: string): Promise<boolean> {
  return browser.permissions.request({ origins: [originPattern(url)] });
}

/** Gives the access back once the capture is done (least privilege). */
export async function releaseSiteAccess(url: string): Promise<void> {
  await browser.permissions.remove({ origins: [originPattern(url)] }).catch(() => false);
}
