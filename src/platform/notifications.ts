import { browser } from 'wxt/browser';
import type { Notifier } from '@/services/ports';

/**
 * chrome.notifications behind the Notifier port. `notifications` is an
 * optional permission (ADR-0015): requested from the board the first time
 * someone turns reminders on, so nobody else sees an install warning.
 */
const permission = () => ({ permissions: ['notifications' as const] });

export class ChromeNotifier implements Notifier {
  granted(): Promise<boolean> {
    return notificationsGranted();
  }

  async notify(id: string, title: string, message: string): Promise<void> {
    await browser.notifications.create(id, {
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon/128.png'),
      title,
      message,
      priority: 1,
    });
  }
}

export function notificationsGranted(): Promise<boolean> {
  return browser.permissions.contains(permission());
}

/** Must be called from a user gesture (a click) in an extension page. */
export function requestNotifications(): Promise<boolean> {
  return browser.permissions.request(permission());
}
