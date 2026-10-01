import { browser } from 'wxt/browser';

/**
 * The side panel (ADR-0021): Rolestash docked on the right of the browser,
 * open across tabs. It needs no page access of its own; saving the current
 * page still runs on the `activeTab` grant from clicking the icon.
 */

const POPUP = 'popup.html';

/** Opens the panel in the current window. Must run inside a click. */
export async function openSidePanel(windowId?: number): Promise<void> {
  const id = windowId ?? (await browser.windows.getCurrent()).id;
  if (id !== undefined) await browser.sidePanel.open({ windowId: id });
}

/** Whether clicking the toolbar icon opens the panel (true) or the popup (false). */
export async function setIconOpensPanel(on: boolean): Promise<void> {
  await browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: on });
  // A popup wins over the panel, so it's cleared while the panel is chosen.
  await browser.action.setPopup({ popup: on ? '' : POPUP });
}

/** Whether the icon is pinned to the toolbar; undefined when Chrome can't say. */
export async function isPinned(): Promise<boolean | undefined> {
  try {
    return (await browser.action.getUserSettings()).isOnToolbar;
  } catch {
    return undefined; // older Chrome
  }
}
