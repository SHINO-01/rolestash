import { browser } from 'wxt/browser';
import { flashBadge } from '@/platform/badge';
import { getServices } from '@/platform/services';
import { openBoard } from '@/platform/tabs';
import { DuplicateJobError } from '@/services/job-service';

/**
 * Background service worker. Deliberately thin: it wires browser events to
 * services and holds no state (MV3 workers are killed when idle).
 *
 *  - Right-click "Track this job"   → capture + save straight to the board
 *  - Alt+Shift+J                    → same
 *  - Right-click the toolbar icon → "Open board"
 */

const MENU_TRACK = 'jobtrail.track';
const MENU_OPEN_BOARD = 'jobtrail.openBoard';
const COMMAND_TRACK = 'track-current-tab';

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    void getServices().ready;
    void browser.contextMenus.removeAll().then(() => {
      browser.contextMenus.create({
        id: MENU_TRACK,
        title: 'Track this job in Jobtrail',
        contexts: ['page', 'frame', 'selection'],
      });
      browser.contextMenus.create({
        id: MENU_OPEN_BOARD,
        title: 'Open Jobtrail board',
        contexts: ['action'],
      });
    });
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_OPEN_BOARD) void openBoard();
    else if (info.menuItemId === MENU_TRACK && tab?.id !== undefined)
      void quickSave(tab.id, tab.url);
  });

  browser.commands.onCommand.addListener((command, tab) => {
    if (command === COMMAND_TRACK && tab?.id !== undefined) void quickSave(tab.id, tab.url);
  });
});

/** One-gesture save with badge feedback; the popup is the path for reviewing first. */
async function quickSave(tabId: number, tabUrl: string | undefined): Promise<void> {
  const services = getServices();
  await services.ready;
  const outcome = await services.capture.capture(tabId, tabUrl);
  if (!outcome.ok) {
    await flashBadge(tabId, '!', 'error');
    return;
  }
  try {
    await services.jobService.createFromExtraction(outcome.result);
    await flashBadge(tabId, '✓', 'success');
  } catch (error) {
    if (error instanceof DuplicateJobError) await flashBadge(tabId, '=', 'info');
    else {
      console.error('[jobtrail] quick save failed', error);
      await flashBadge(tabId, '!', 'error');
    }
  }
}
