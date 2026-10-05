import { WIDGET_FRAME_SOURCE } from './widget-protocol';

/** Inside the widget's iframe on a page (rather than opened as a tab, e.g. in tests). */
export const embedded = window.parent !== window;

function post(message: { type: 'resize'; height: number } | { type: 'close' }): void {
  // The parent is a web page of any origin; it receives only a size or "close".
  window.parent.postMessage({ source: WIDGET_FRAME_SOURCE, ...message }, '*');
}

/** Closes the widget (or the window, outside a page). */
export function closeWidget(): void {
  if (embedded) post({ type: 'close' });
  else window.close();
}

/** Keeps the iframe as tall as the content. Returns a cleanup function. */
export function reportHeight(element: HTMLElement): () => void {
  if (!embedded) return () => undefined;
  const send = () => post({ type: 'resize', height: Math.ceil(element.scrollHeight) });
  const observer = new ResizeObserver(send);
  observer.observe(element);
  send();
  return () => observer.disconnect();
}
