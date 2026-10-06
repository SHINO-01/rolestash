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

/**
 * Pages where the button appears by itself: every web page (ADR-0031),
 * except Rolestash's own site, which has its own way in.
 */
export function showsLauncher(href: string): boolean {
  try {
    const url = new URL(href);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    return url.hostname !== 'rolestash.com' && !url.hostname.endsWith('.rolestash.com');
  } catch {
    return false;
  }
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
