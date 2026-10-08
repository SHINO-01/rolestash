import { browser } from 'wxt/browser';
import { flashBadge } from '@/platform/badge';
import { ChromeNotifier } from '@/platform/notifications';
import { getServices } from '@/platform/services';
import { syncAllSites } from '@/platform/all-sites';
import { toggleWidget } from '@/platform/widget';
import { openBoard } from '@/platform/tabs';
import { AutofillBlockedError } from '@/services/autofill-service';
import { DuplicateJobError, JobLimitError } from '@/services/job-service';
import { FOLLOW_UP_PREFIX, ReminderService } from '@/services/reminder-service';
import { EMAIL_UPDATE_PREFIX } from '@/services/email-update-service';
import { WEB_HANDOFF_MESSAGE, type WebHandoffReply } from '@/services/web-handoff';

/**
 * Background service worker. Deliberately thin: it wires browser events to
 * services and holds no state (MV3 workers are killed when idle).
 *
 *  - Toolbar icon / Alt+J          → the floating widget on this page (ADR-0030);
 *                                   the board where pages can't have it
 *  - Right-click "Track this job"   → capture + save straight to the board
 *  - Alt+Shift+J                    → same
 *  - Right-click "Fill this application" → fill the form from the profile (Pro; ADR-0020)
 *  - Right-click the toolbar icon → "Open board"
 *  - Every 15 minutes             → follow-up reminders, closing-soon digest (ADR-0015),
 *                                   email updates (ADR-0014) and sync (ADR-0016)
 *  - Browser startup, then every 5 minutes with a connected mailbox
 *                                 → read new job mail on this device and update the
 *                                   board (ADR-0032), then sync
 *  - The web board asks to sign in → a single-use token for this account (ADR-0017)
 *  - First install                → open the board, where the guided tour starts (ADR-0039)
 */

const MENU_TRACK = 'rolestash.track';
const MENU_OPEN_BOARD = 'rolestash.openBoard';
const MENU_AUTOFILL = 'rolestash.autofill';
const COMMAND_TRACK = 'track-current-tab';
const ALARM_REMINDERS = 'rolestash.reminders';
const ALARM_MAIL = 'rolestash.mail';
const MAIL_PERIOD_MINUTES = 5;
/** Where the web board may message from (also limited by externally_connectable). */
const BOARD_ORIGINS = new Set(['https://rolestash.com', 'http://localhost']);
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

/** A click on a reminder or an email update opens the job's card (or the board, for a summary). */
function listenForNotificationClicks(): void {
  const notifications = browser.notifications as typeof browser.notifications | undefined;
  if (listeningForClicks || !notifications) return;
  listeningForClicks = true;
  notifications.onClicked.addListener((id) => {
    const card = [FOLLOW_UP_PREFIX, EMAIL_UPDATE_PREFIX].find((p) => id.startsWith(p));
    void openBoard(card ? id.slice(card.length) : undefined);
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

/** Idempotent: the connected-mailbox check, every few minutes (ADR-0032). */
async function ensureMailAlarm(): Promise<void> {
  if (!(await browser.alarms.get(ALARM_MAIL)))
    await browser.alarms.create(ALARM_MAIL, { periodInMinutes: MAIL_PERIOD_MINUTES });
}

/** Only when a mailbox is connected: otherwise the 15-minute tick is enough. */
async function checkMailbox(): Promise<void> {
  const services = getServices();
  await services.ready;
  if (!(await services.mailbox?.state())) return;
  await syncAndEmail();
}

async function syncAndEmail(): Promise<void> {
  const services = getServices();
  await services.ready;
  await services.email?.run().catch(() => undefined);
  await services.sync?.sync().catch(() => undefined);
}

export default defineBackground(() => {
  browser.runtime.onStartup.addListener(() => {
    void ensureReminderAlarm();
    void ensureMailAlarm();
    void syncAllSites().catch(() => undefined);
    // The browser just opened: bring the board up to date with the mailbox straight away.
    void checkMailbox();
  });
  browser.action.onClicked.addListener((tab) => {
    if (tab.id === undefined) return;
    void toggleWidget(tab.id).then((shown) => (shown ? undefined : openBoard()));
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_MAIL) {
      void checkMailbox();
      return;
    }
    if (alarm.name !== ALARM_REMINDERS) return;
    runReminders().catch((error: unknown) => console.error('[rolestash] reminders failed', error));
    // The same 15-minute tick applies email updates (ADR-0014) and then keeps
    // synced devices in step (ADR-0016), so those changes go out at once. The
    // board shows problems with either, so failures are not logged here.
    void syncAndEmail();
  });
  // The notifications API exists only once the optional permission is granted.
  listenForNotificationClicks();
  browser.permissions.onAdded.addListener(() => {
    listenForNotificationClicks();
    void syncAllSites().catch(() => undefined);
  });
  // Taken back in chrome://extensions too: the button leaves other sites at once.
  browser.permissions.onRemoved.addListener(() => void syncAllSites().catch(() => undefined));

  browser.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    if (
      (message as { type?: unknown } | null)?.type !== WEB_HANDOFF_MESSAGE ||
      !fromBoard(sender.url)
    )
      return false;
    void webHandoff().then(sendResponse);
    return true; // responds asynchronously
  });

  browser.runtime.onInstalled.addListener((details) => {
    void getServices().ready;
    // A first install opens the board, where the guided tour starts (ADR-0039).
    // E2E runs install fresh every time and open the pages they need themselves.
    if (details.reason === 'install' && import.meta.env.MODE !== 'e2e') void openBoard();
    void ensureReminderAlarm();
    void ensureMailAlarm();
    void syncAllSites().catch(() => undefined);
    void browser.contextMenus.removeAll().then(() => {
      browser.contextMenus.create({
        id: MENU_TRACK,
        title: 'Track this job in Rolestash',
        contexts: ['page', 'frame', 'selection'],
      });
      browser.contextMenus.create({
        id: MENU_AUTOFILL,
        title: 'Fill this application with Rolestash',
        contexts: ['page', 'frame', 'editable'],
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
    else if (info.menuItemId === MENU_AUTOFILL && tab?.id !== undefined) void autofill(tab.id);
    else if (info.menuItemId === MENU_TRACK && tab?.id !== undefined)
      void quickSave(tab.id, tab.url);
  });

  browser.commands.onCommand.addListener((command, tab) => {
    if (command === COMMAND_TRACK && tab?.id !== undefined) void quickSave(tab.id, tab.url);
  });
});

/** Fills the form in the tab; the badge shows how many fields were filled. */
async function autofill(tabId: number): Promise<void> {
  const services = getServices();
  await services.ready;
  if (!services.autofill) return;
  try {
    const outcome = await services.autofill.fill(tabId);
    await flashBadge(
      tabId,
      String(outcome.filled.length),
      outcome.filled.length ? 'success' : 'info',
    );
  } catch (error) {
    if (error instanceof AutofillBlockedError)
      await openBoard(error.reason === 'plan' ? { account: true } : { profile: true });
    else await flashBadge(tabId, '!', 'error');
  }
}

/** One-gesture save with badge feedback; the widget is the path for reviewing first. */
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

function fromBoard(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return BOARD_ORIGINS.has(`${u.protocol}//${u.hostname}`) && u.pathname.startsWith('/board/');
  } catch {
    return false;
  }
}

/** A single-use sign-in token when this browser is signed in; nothing otherwise. */
async function webHandoff(): Promise<WebHandoffReply> {
  const services = getServices();
  await services.ready;
  const account = services.account;
  if (!account || !(await account.state()).signedIn) return {};
  try {
    return { tokenHash: await account.webHandoffToken() };
  } catch {
    return {};
  }
}
