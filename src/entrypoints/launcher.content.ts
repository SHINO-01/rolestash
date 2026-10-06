import { browser } from 'wxt/browser';
import { looksLikeJobView } from '@/extraction/job-view';
import {
  dropPosition,
  LAUNCHER_POSITION_KEY,
  placeLauncher,
  readPosition,
  type LauncherPosition,
} from '@/features/capture/launcher-position';
import {
  isWidgetFrameMessage,
  showsLauncher,
  WIDGET_HIDDEN_SITES_KEY,
  WIDGET_TOGGLE,
} from '@/features/capture/widget-protocol';

/**
 * The floating widget on the page (ADR-0030, ADR-0031). On every web page
 * it shows a small button: the Rolestash logo, which says "Save job" while
 * a job is open. It can be dragged to any height on the left or right edge,
 * remembers where, and can be hidden per site. The toolbar icon opens the
 * panel too (and injects this script into tabs opened before an update).
 *
 * The page sees only a closed shadow root holding a button and an iframe of
 * the extension's widget page, which does all the work. Nothing from the
 * page reaches the widget page: the iframe only tells this script its
 * height and when to close, and both are checked to come from it.
 */
export default defineContentScript({
  // Every web page (ADR-0031). It reads nothing until the panel opens.
  matches: ['https://*/*', 'http://*/*'],
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
  position: fixed; left: 0; top: 0; z-index: 2147483646;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  min-width: 48px; height: 48px; padding: 0; box-sizing: border-box;
  border: 0; border-radius: 14px; cursor: grab; touch-action: none; user-select: none;
  background: #0B5D52; color: #FFF7E6;
  box-shadow: 0 6px 20px rgb(0 0 0 / 0.22), 0 0 0 1px rgb(255 255 255 / 0.08) inset;
  font: 600 13px/1 system-ui, -apple-system, 'Segoe UI', sans-serif;
  transition: transform 120ms ease, box-shadow 120ms ease, filter 120ms ease;
}
.launcher.job { padding: 0 14px 0 10px; }
.launcher .label { display: none; white-space: nowrap; }
.launcher.job .label { display: inline; }
.launcher:hover { filter: brightness(1.08); }
.launcher:focus-visible { outline: 3px solid #F4B63F; outline-offset: 2px; }
.launcher img { width: 30px; height: 30px; flex: none; border-radius: 8px; pointer-events: none; }
/* Held down or being moved: pressed into the page. */
.launcher.pressed {
  transform: scale(0.92); filter: brightness(0.92);
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.25), 0 3px 8px rgb(0 0 0 / 0.35) inset;
}
.launcher.dragging { cursor: grabbing; }
.launcher.snapping { transition: left 220ms cubic-bezier(.2,.8,.2,1), top 220ms cubic-bezier(.2,.8,.2,1), transform 120ms ease; }
.panel {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
  width: 380px; max-width: calc(100vw - 32px); height: 220px; max-height: calc(100vh - 32px);
  border-radius: 16px; overflow: hidden; background: #fff;
  box-shadow: 0 24px 60px rgb(0 0 0 / 0.28), 0 0 0 1px rgb(0 0 0 / 0.08);
  animation: rise 160ms cubic-bezier(.2,.8,.2,1);
}
.panel.left { left: 16px; right: auto; }
.panel iframe { display: block; width: 100%; height: 100%; border: 0; color-scheme: normal; }
@keyframes rise { from { opacity: 0; transform: translateY(8px) scale(.98); } }
@media (prefers-reduced-motion: reduce) { .launcher, .launcher.snapping, .panel { transition: none; animation: none; } }
@media (prefers-color-scheme: dark) { .panel { background: #17191c; } }
`;

/** Pointer travel (px) that turns a press into a drag rather than a click. */
const DRAG_THRESHOLD = 4;

function createWidget(onWebPage: boolean) {
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
  /** Opened here from the toolbar: keep the button on this page afterwards. */
  let openedHere = false;
  let position: LauncherPosition = readPosition(undefined);

  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.className = 'launcher';
  launcher.title = 'Rolestash (drag to move)';
  launcher.setAttribute('aria-label', 'Open Rolestash');
  // Built from elements, not HTML, so pages with Trusted Types allow it.
  const mark = document.createElement('img');
  mark.src = browser.runtime.getURL('/icon/48.png');
  mark.alt = '';
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = 'Save job';
  launcher.append(mark, label);

  const view = () => ({ width: window.innerWidth, height: window.innerHeight });
  const place = () => {
    const box = { width: launcher.offsetWidth || 48, height: launcher.offsetHeight || 48 };
    const { left, top } = placeLauncher(position, view(), box);
    launcher.style.left = `${String(left)}px`;
    launcher.style.top = `${String(top)}px`;
  };
  const save = (next: LauncherPosition) => {
    position = next;
    void browser.storage.local.set({ [LAUNCHER_POSITION_KEY]: next });
  };

  // "Save job" only while a job is open; a plain logo on feeds, lists and
  // every other page. Checked a few times after each address change (pages
  // add their job data late), then left alone, so idle tabs cost nothing.
  let checkedHref = '';
  let checksLeft = 0;
  const showJobState = () => {
    if (location.href !== checkedHref) {
      checkedHref = location.href;
      checksLeft = 4;
    }
    if (checksLeft <= 0) return;
    checksLeft -= 1;
    const job = looksLikeJobView(new URL(location.href), document);
    if (launcher.classList.contains('job') === job) return;
    launcher.classList.toggle('job', job);
    launcher.title = job ? 'Rolestash: save this job (drag to move)' : 'Rolestash (drag to move)';
    place();
  };
  const watchJob = window.setInterval(showJobState, 1500);

  const showOrHideLauncher = () => {
    const wanted = (onWebPage || openedHere) && !hidden && !panel;
    if (wanted && !launcher.isConnected) {
      root.append(launcher);
      showJobState();
      place();
    }
    if (!wanted) launcher.remove();
  };

  // Dragging: press, move past a few pixels, let go; it snaps to the nearer edge.
  let press: { x: number; y: number; dx: number; dy: number; moved: boolean } | undefined;
  let swallowClick = false;
  launcher.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const rect = launcher.getBoundingClientRect();
    press = {
      x: event.clientX,
      y: event.clientY,
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
      moved: false,
    };
    launcher.setPointerCapture(event.pointerId);
    launcher.classList.remove('snapping');
    launcher.classList.add('pressed');
  });
  launcher.addEventListener('pointermove', (event) => {
    if (!press) return;
    if (
      !press.moved &&
      Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_THRESHOLD
    )
      return;
    press.moved = true;
    launcher.classList.add('dragging');
    launcher.style.left = `${String(event.clientX - press.dx)}px`;
    launcher.style.top = `${String(event.clientY - press.dy)}px`;
  });
  const release = (event: PointerEvent) => {
    if (!press) return;
    const moved = press.moved;
    press = undefined;
    launcher.classList.remove('pressed', 'dragging');
    if (!moved) return;
    swallowClick = true;
    const rect = launcher.getBoundingClientRect();
    save(
      dropPosition(
        { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        view(),
        rect.height,
      ),
    );
    launcher.classList.add('snapping');
    place();
    if (event.type === 'pointercancel') swallowClick = false;
  };
  launcher.addEventListener('pointerup', release);
  launcher.addEventListener('pointercancel', release);
  launcher.addEventListener('click', () => {
    if (swallowClick) {
      swallowClick = false;
      return;
    }
    open();
  });
  // The keyboard moves it too: up and down along the edge, left and right between edges.
  launcher.addEventListener('keydown', (event) => {
    const step = 0.05;
    const next =
      event.key === 'ArrowUp'
        ? { ...position, top: Math.max(0, position.top - step) }
        : event.key === 'ArrowDown'
          ? { ...position, top: Math.min(1, position.top + step) }
          : event.key === 'ArrowLeft'
            ? { ...position, side: 'left' as const }
            : event.key === 'ArrowRight'
              ? { ...position, side: 'right' as const }
              : undefined;
    if (!next) return;
    event.preventDefault();
    save(next);
    launcher.classList.add('snapping');
    place();
  });
  const onResize = () => place();
  window.addEventListener('resize', onResize);

  // "Hide the button on this site", chosen in the widget, and where it was left.
  const readHidden = (value: unknown) => {
    hidden = Array.isArray(value) && value.includes(location.hostname);
    showOrHideLauncher();
  };
  void browser.storage.local
    .get([WIDGET_HIDDEN_SITES_KEY, LAUNCHER_POSITION_KEY])
    .then((stored) => {
      position = readPosition(stored[LAUNCHER_POSITION_KEY]);
      readHidden(stored[WIDGET_HIDDEN_SITES_KEY]);
      place();
    });
  const onStorage = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local') return;
    const hiddenChange = changes[WIDGET_HIDDEN_SITES_KEY];
    if (hiddenChange) readHidden(hiddenChange.newValue);
    // Moved in another tab: follow it.
    const moved = changes[LAUNCHER_POSITION_KEY];
    if (moved) {
      position = readPosition(moved.newValue);
      place();
    }
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
    openedHere = true;
    panel = document.createElement('div');
    // The panel opens on the side the button lives on.
    panel.className = position.side === 'left' ? 'panel left' : 'panel';
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
    if (launcher.isConnected) launcher.focus({ preventScroll: true });
  }

  showOrHideLauncher();
  return {
    toggle: () => (panel ? close() : open()),
    destroy: () => {
      close();
      window.clearInterval(watchJob);
      window.removeEventListener('message', onFrameMessage);
      window.removeEventListener('resize', onResize);
      browser.storage.onChanged.removeListener(onStorage);
      host.remove();
    },
  };
}
