// The one script on rolestash.com: the light/dark switch, and playing the
// hero film while it's on screen. Loaded in <head> (not deferred) so a saved
// theme applies before the first paint. With no saved choice the site follows the system setting. The
// choice stays in this browser's local storage and is never sent anywhere.
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

  /**
   * The hero film (no sound; a vertical cut on small screens) plays while a
   * quarter of it is on screen, never with reduced motion (CSS shows the
   * board pictures instead). The hidden cut never intersects, so it stays
   * paused. Without this script the film shows its poster.
   */
  function film() {
    for (const video of document.querySelectorAll('.film video')) {
      let visible = false;
      const update = () => {
        if (visible && !reduceMotion.matches) video.play().catch(() => undefined);
        else video.pause();
      };
      reduceMotion.addEventListener('change', update);
      new IntersectionObserver(
        ([entry]) => {
          visible = entry?.isIntersecting ?? false;
          update();
        },
        { threshold: 0.25 },
      ).observe(video);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    sync();
    for (const button of document.querySelectorAll('.theme-toggle'))
      button.addEventListener('click', toggle);
    film();
  });
  systemDark.addEventListener('change', sync);
})();
