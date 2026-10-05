import { browser } from 'wxt/browser';
import { JOB_SITE_MATCHES } from '@/extraction/adapters/job-sites';
import {
  isWidgetFrameMessage,
  showsLauncher,
  WIDGET_HIDDEN_SITES_KEY,
  WIDGET_TOGGLE,
} from '@/features/capture/widget-protocol';

/**
 * The floating widget on the page (ADR-0030). On the supported job sites it
 * shows a small launcher by itself; on any other page the toolbar icon
 * injects it (activeTab) and opens the panel straight away.
 *
 * The page sees only a closed shadow root holding a button and an iframe of
 * the extension's widget page, which does all the work. Nothing from the
 * page reaches the widget page: the iframe only tells this script its
 * height and when to close, and both are checked to come from it.
 */
export default defineContentScript({
  matches: [...JOB_SITE_MATCHES],
  runAt: 'document_idle',
  main(ctx) {
    const scope = window as Window & { __rolestashWidget?: { toggle: () => void } };
    if (scope.__rolestashWidget) return;
    const widget = createWidget(showsLauncher(location.href));
    scope.__rolestashWidget = widget;
    const onMessage = (message: unknown) => {
      if ((message as { type?: unknown } | null)?.type === WIDGET_TOGGLE) widget.toggle();
    };
    browser.runtime.onMessage.addListener(onMessage);
    ctx.onInvalidated(() => {
      browser.runtime.onMessage.removeListener(onMessage);
      widget.destroy();
      delete scope.__rolestashWidget;
    });
  },
});

const STYLE = `
:host { all: initial; }
.launcher {
  position: fixed; right: 0; bottom: 112px; z-index: 2147483646;
  display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 14px 0 8px;
  border: 0; border-radius: 14px 0 0 14px; cursor: pointer;
  background: #0B5D52; color: #FFF7E6; box-shadow: 0 6px 20px rgb(0 0 0 / 0.22);
  font: 600 13px/1 system-ui, -apple-system, 'Segoe UI', sans-serif;
  transform: translateX(calc(100% - 44px)); transition: transform 180ms cubic-bezier(.2,.8,.2,1);
}
.launcher:hover, .launcher:focus-visible { transform: none; }
.launcher:focus-visible { outline: 3px solid #F4B63F; outline-offset: 2px; }
.launcher img { width: 28px; height: 28px; flex: none; border-radius: 8px; }
.panel {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
  width: 380px; max-width: calc(100vw - 32px); height: 220px; max-height: calc(100vh - 32px);
  border-radius: 16px; overflow: hidden; background: #fff;
  box-shadow: 0 24px 60px rgb(0 0 0 / 0.28), 0 0 0 1px rgb(0 0 0 / 0.08);
  animation: rise 160ms cubic-bezier(.2,.8,.2,1);
}
.panel iframe { display: block; width: 100%; height: 100%; border: 0; color-scheme: normal; }
@keyframes rise { from { opacity: 0; transform: translateY(8px) scale(.98); } }
@media (prefers-reduced-motion: reduce) { .launcher, .panel { transition: none; animation: none; } }
@media (prefers-color-scheme: dark) { .panel { background: #17191c; } }
`;

function createWidget(showLauncher: boolean) {
  const host = document.createElement('rolestash-widget');
  // Closed, so the page's scripts can't reach in; open only in E2E builds, for Playwright.
  const root = host.attachShadow({ mode: import.meta.env.MODE === 'e2e' ? 'open' : 'closed' });
  const style = document.createElement('style');
  style.textContent = STYLE;
  root.append(style);
  document.documentElement.append(host);

  const origin = new URL(browser.runtime.getURL('/')).origin;
  let panel: HTMLDivElement | undefined;
  let frame: HTMLIFrameElement | undefined;
  let watchUrl: number | undefined;
  let hidden = false;

  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.className = 'launcher';
  launcher.title = 'Rolestash: save this job';
  launcher.setAttribute('aria-label', 'Open Rolestash');
  // Built from elements, not HTML, so pages with Trusted Types allow it.
  const mark = document.createElement('img');
  mark.src = browser.runtime.getURL('/icon/48.png');
  mark.alt = '';
  const label = document.createElement('span');
  label.textContent = 'Save job';
  launcher.append(mark, label);
  launcher.addEventListener('click', () => open());

  const showOrHideLauncher = () => {
    const wanted = showLauncher && !hidden && !panel;
    if (wanted && !launcher.isConnected) root.append(launcher);
    if (!wanted) launcher.remove();
  };

  // "Hide the button on this site", chosen in the widget.
  const readHidden = (value: unknown) => {
    hidden = Array.isArray(value) && value.includes(location.hostname);
    showOrHideLauncher();
  };
  if (showLauncher)
    void browser.storage.local
      .get(WIDGET_HIDDEN_SITES_KEY)
      .then((stored) => readHidden(stored[WIDGET_HIDDEN_SITES_KEY]));
  const onStorage = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    const change = changes[WIDGET_HIDDEN_SITES_KEY];
    if (area === 'local' && change) readHidden(change.newValue);
  };
  browser.storage.onChanged.addListener(onStorage);

  const onFrameMessage = (event: MessageEvent) => {
    const from = frame?.contentWindow;
    if (!from || event.source !== from || event.origin !== origin) return;
    if (!isWidgetFrameMessage(event.data)) return;
    if (event.data.type === 'close') close();
    else if (panel) panel.style.height = `${String(Math.max(120, event.data.height))}px`;
  };
  window.addEventListener('message', onFrameMessage);

  function open() {
    if (panel) return;
    panel = document.createElement('div');
    panel.className = 'panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Rolestash');
    frame = document.createElement('iframe');
    frame.title = 'Rolestash';
    frame.src = browser.runtime.getURL('/widget.html');
    frame.allow = 'clipboard-write';
    panel.append(frame);
    root.append(panel);
    showOrHideLauncher();
    frame.addEventListener('load', () => frame?.focus(), { once: true });
    // Single-page sites (LinkedIn, SEEK) change jobs without loading a page:
    // read the new one.
    let url = location.href;
    watchUrl = window.setInterval(() => {
      if (location.href === url || !frame) return;
      url = location.href;
      frame.src = browser.runtime.getURL('/widget.html');
    }, 1000);
  }

  function close() {
    window.clearInterval(watchUrl);
    panel?.remove();
    panel = undefined;
    frame = undefined;
    showOrHideLauncher();
    if (showLauncher && !hidden) launcher.focus({ preventScroll: true });
  }

  showOrHideLauncher();
  return {
    toggle: () => (panel ? close() : open()),
    destroy: () => {
      close();
      window.removeEventListener('message', onFrameMessage);
      browser.storage.onChanged.removeListener(onStorage);
      host.remove();
    },
  };
}
