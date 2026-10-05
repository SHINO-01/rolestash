import { isJobSite } from '@/extraction/adapters/job-sites';

/**
 * Messages between the floating widget's parts (ADR-0030):
 *
 *  - background → content script: `WIDGET_TOGGLE` (toolbar icon, Alt+J);
 *  - widget page (in the iframe) → content script: `resize` and `close`,
 *    by `postMessage` to the parent window, checked against the iframe's
 *    window and the extension's origin.
 *
 * Nothing is ever sent into the widget page: it reads only extension
 * storage, so a page can't steer it.
 */
export const WIDGET_TOGGLE = 'rolestash:widget-toggle';
export const WIDGET_FRAME_SOURCE = 'rolestash-widget';

export type WidgetFrameMessage =
  | { source: typeof WIDGET_FRAME_SOURCE; type: 'resize'; height: number }
  | { source: typeof WIDGET_FRAME_SOURCE; type: 'close' };

/** Pages where the launcher appears by itself: the job sites (and local pages in E2E builds). */
export function showsLauncher(href: string): boolean {
  if (import.meta.env.MODE === 'e2e') {
    try {
      if (['localhost', '127.0.0.1'].includes(new URL(href).hostname)) return true;
    } catch {
      return false;
    }
  }
  return isJobSite(href);
}

/** Sites where the widget's launcher is hidden ("Hide on this site"), by hostname. */
export const WIDGET_HIDDEN_SITES_KEY = 'widget:hiddenSites';

export function isWidgetFrameMessage(data: unknown): data is WidgetFrameMessage {
  if (typeof data !== 'object' || data === null) return false;
  const m = data as Record<string, unknown>;
  if (m.source !== WIDGET_FRAME_SOURCE) return false;
  if (m.type === 'close') return true;
  return m.type === 'resize' && typeof m.height === 'number' && Number.isFinite(m.height);
}
