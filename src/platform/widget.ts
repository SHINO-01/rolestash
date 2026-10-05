import { browser } from 'wxt/browser';
import { WIDGET_TOGGLE } from '@/features/capture/widget-protocol';

/**
 * Opens or closes the floating widget in a tab (ADR-0030). On the supported
 * job sites its script is already there; anywhere else it's injected now,
 * which the toolbar click allows (activeTab). False on pages Chrome keeps
 * extensions out of (chrome://, the Web Store).
 */
export async function toggleWidget(tabId: number): Promise<boolean> {
  const toggle = () => browser.tabs.sendMessage(tabId, { type: WIDGET_TOGGLE });
  try {
    await toggle();
    return true;
  } catch {
    // Not on this page yet.
  }
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: ['/content-scripts/launcher.js'],
    });
    await toggle();
    return true;
  } catch {
    return false;
  }
}

/** Whether the icon is pinned to the toolbar; undefined when Chrome can't say. */
export async function isPinned(): Promise<boolean | undefined> {
  try {
    return (await browser.action.getUserSettings()).isOnToolbar;
  } catch {
    return undefined; // older Chrome
  }
}
