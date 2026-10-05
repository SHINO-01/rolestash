import { browser } from 'wxt/browser';

export interface ActiveTab {
  id: number;
  url: string | undefined;
  title: string | undefined;
  favIconUrl: string | undefined;
}

export async function getActiveTab(): Promise<ActiveTab | undefined> {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined) return undefined;
  return { id: tab.id, url: tab.url, title: tab.title, favIconUrl: tab.favIconUrl };
}

/**
 * The tab the widget is framed in (ADR-0030): its own tab, not whichever is
 * active, so a second window can't swap the page. Falls back to the active
 * tab where there is no tab of its own.
 */
export async function getWidgetTab(): Promise<ActiveTab | undefined> {
  const tab = await browser.tabs.getCurrent();
  if (tab?.id === undefined) return getActiveTab();
  return { id: tab.id, url: tab.url, title: tab.title, favIconUrl: tab.favIconUrl };
}

export const BOARD_PATH = '/board.html';

/**
 * Focuses an open board tab, or opens a new one. Optional `jobId` deep-links
 * a card; `account` opens the account dialog and `profile` the autofill profile.
 */
export async function openBoard(
  target?: string | { account: true } | { profile: true },
): Promise<void> {
  const base = browser.runtime.getURL(BOARD_PATH);
  const url =
    target === undefined
      ? base
      : typeof target === 'string'
        ? `${base}#job=${encodeURIComponent(target)}`
        : 'profile' in target
          ? `${base}#profile`
          : `${base}#account`;
  // runtime.getContexts (Chrome 116+) finds our own pages without the `tabs` permission.
  const contexts = await browser.runtime.getContexts({
    contextTypes: ['TAB'],
  });
  const existing = contexts.find((c) => c.tabId !== -1 && c.documentUrl?.startsWith(base));
  if (existing) {
    await browser.tabs.update(existing.tabId, { active: true, url });
    if (existing.windowId !== -1)
      await browser.windows.update(existing.windowId, { focused: true });
    return;
  }
  await browser.tabs.create({ url });
}
