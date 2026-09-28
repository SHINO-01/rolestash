import { browser } from 'wxt/browser';

const COLORS = { success: '#16a34a', info: '#2563eb', error: '#dc2626' } as const;

/** Briefly shows a badge on the toolbar icon for one tab (feedback for menu/shortcut saves). */
export async function flashBadge(
  tabId: number,
  text: string,
  tone: keyof typeof COLORS,
  durationMs = 4000,
): Promise<void> {
  await browser.action.setBadgeBackgroundColor({ tabId, color: COLORS[tone] });
  await browser.action.setBadgeText({ tabId, text });
  setTimeout(() => {
    void browser.action.setBadgeText({ tabId, text: '' }).catch(() => undefined);
  }, durationMs);
}
