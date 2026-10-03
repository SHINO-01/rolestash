// Light/dark switch for rolestash.com. Loaded in <head> (not deferred) so a
// saved choice applies before the first paint. With no saved choice the site
// follows the system setting. The choice stays in this browser's local
// storage and is never sent anywhere.
(() => {
  const KEY = 'rolestash-theme';
  const root = document.documentElement;
  const COLORS = { light: '#fbfaf7', dark: '#0b0f0e' };
  const systemDark = matchMedia('(prefers-color-scheme: dark)');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  let saved = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    // Storage blocked (private mode, settings): the switch still works per page.
  }
  if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;
  root.classList.add('theme-ready');

  const current = () => root.dataset.theme ?? (systemDark.matches ? 'dark' : 'light');

  function sync() {
    const dark = current() === 'dark';
    for (const button of document.querySelectorAll('.theme-toggle')) {
      button.setAttribute('aria-pressed', String(dark));
      button.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    }
    if (root.dataset.theme) {
      for (const meta of document.querySelectorAll('meta[name="theme-color"]'))
        meta.setAttribute('content', COLORS[current()]);
    }
  }

  function apply(theme) {
    root.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // Not remembered, but applied.
    }
    sync();
  }

  /** The new theme grows out of the switch as a circle (View Transitions). */
  function toggle(event) {
    const next = current() === 'dark' ? 'light' : 'dark';
    if (!document.startViewTransition || reduceMotion.matches) {
      apply(next);
      return;
    }
    const box = event.currentTarget.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const transition = document.startViewTransition(() => apply(next));
    transition.ready
      .then(() => {
        root.animate(
          {
            clipPath: [
              `circle(0px at ${String(x)}px ${String(y)}px)`,
              `circle(${String(radius)}px at ${String(x)}px ${String(y)}px)`,
            ],
          },
          {
            duration: 700,
            easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
            pseudoElement: '::view-transition-new(root)',
          },
        );
      })
      .catch(() => undefined);
  }

  document.addEventListener('DOMContentLoaded', () => {
    sync();
    for (const button of document.querySelectorAll('.theme-toggle'))
      button.addEventListener('click', toggle);
  });
  systemDark.addEventListener('change', sync);
})();
