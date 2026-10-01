import { browser } from 'wxt/browser';
import { flashBadge } from '@/platform/badge';
import { ChromeNotifier } from '@/platform/notifications';
import { getServices } from '@/platform/services';
import { openBoard } from '@/platform/tabs';
import { DuplicateJobError, JobLimitError } from '@/services/job-service';
import { FOLLOW_UP_PREFIX, ReminderService } from '@/services/reminder-service';

/**
 * Background service worker. Deliberately thin: it wires browser events to
 * services and holds no state (MV3 workers are killed when idle).
 *
 *  - Right-click "Track this job"   → capture + save straight to the board
 *  - Alt+Shift+J                    → same
 *  - Right-click the toolbar icon → "Open board"
 *  - Every 15 minutes             → follow-up reminders, closing-soon digest (ADR-0015)
 */

const MENU_TRACK = 'rolestash.track';
const MENU_OPEN_BOARD = 'rolestash.openBoard';
const COMMAND_TRACK = 'track-current-tab';
const ALARM_REMINDERS = 'rolestash.reminders';
const REMINDER_PERIOD_MINUTES = 15;

/** Idempotent: keeps an existing alarm's schedule. */
async function ensureReminderAlarm(): Promise<void> {
  if (!(await browser.alarms.get(ALARM_REMINDERS)))
    await browser.alarms.create(ALARM_REMINDERS, {
      delayInMinutes: 1,
      periodInMinutes: REMINDER_PERIOD_MINUTES,
    });
}

let listeningForClicks = false;

/** A click on a reminder opens the job's card (or the board, for a summary). */
function listenForNotificationClicks(): void {
  const notifications = browser.notifications as typeof browser.notifications | undefined;
  if (listeningForClicks || !notifications) return;
  listeningForClicks = true;
  notifications.onClicked.addListener((id) => {
    void openBoard(id.startsWith(FOLLOW_UP_PREFIX) ? id.slice(FOLLOW_UP_PREFIX.length) : undefined);
    void notifications.clear(id);
  });
}

async function runReminders(): Promise<void> {
  const services = getServices();
  await services.ready;
  await new ReminderService(
    services.jobs,
    services.settings,
    services.store,
    new ChromeNotifier(),
    services.account,
  ).run();
}

export default defineBackground(() => {
  browser.runtime.onStartup.addListener(() => void ensureReminderAlarm());
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_REMINDERS)
      runReminders().catch((error: unknown) =>
        console.error('[rolestash] reminders failed', error),
      );
  });
  // The notifications API exists only once the optional permission is granted.
  listenForNotificationClicks();
  browser.permissions.onAdded.addListener(() => listenForNotificationClicks());

  browser.runtime.onInstalled.addListener(() => {
    void getServices().ready;
    void ensureReminderAlarm();
    void browser.contextMenus.removeAll().then(() => {
      browser.contextMenus.create({
        id: MENU_TRACK,
        title: 'Track this job in Rolestash',
        contexts: ['page', 'frame', 'selection'],
      });
      browser.contextMenus.create({
        id: MENU_OPEN_BOARD,
        title: 'Open Rolestash board',
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
    else if (error instanceof JobLimitError) await flashBadge(tabId, 'MAX', 'error', 6000);
    else {
      console.error('[rolestash] quick save failed', error);
      await flashBadge(tabId, '!', 'error');
    }
  }
}
