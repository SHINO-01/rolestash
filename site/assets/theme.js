// The one script on rolestash.com: the light/dark switch and the hero film's
// buttons. Loaded in <head> (not deferred) so a saved theme applies before the
// first paint. With no saved choice the site follows the system setting. The
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
   * The hero film plays muted while it's on screen, never with reduced motion
   * (CSS shows the board pictures instead). The buttons pause it and turn the
   * sound on, from the start. Without this script the browser's own controls
   * stay and nothing plays by itself.
   */
  function film() {
    const box = document.querySelector('.film');
    const video = box?.querySelector('video');
    const playButton = box?.querySelector('.film-play');
    const soundButton = box?.querySelector('.film-sound');
    if (!box || !video || !playButton || !soundButton) return;
    video.controls = false;
    box.classList.add('film-ready');
    let held = false; // paused by the visitor, or by reduced motion
    let visible = false;

    const label = () => {
      box.dataset.paused = String(video.paused);
      box.dataset.muted = String(video.muted);
      playButton.setAttribute('aria-label', video.paused ? 'Play video' : 'Pause video');
      soundButton.setAttribute('aria-label', video.muted ? 'Turn sound on' : 'Turn sound off');
    };
    const update = () => {
      if (visible && !held && !reduceMotion.matches) video.play().catch(() => undefined);
      else video.pause();
    };

    playButton.addEventListener('click', () => {
      held = !video.paused;
      if (held) video.pause();
      else video.play().catch(() => undefined);
    });
    soundButton.addEventListener('click', () => {
      video.muted = !video.muted;
      if (!video.muted) {
        video.currentTime = 0;
        held = false;
        video.play().catch(() => undefined);
      }
    });
    for (const event of ['play', 'pause', 'volumechange']) video.addEventListener(event, label);
    reduceMotion.addEventListener('change', update);
    new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? false;
        update();
      },
      { threshold: 0.25 },
    ).observe(video);
    label();
  }

  document.addEventListener('DOMContentLoaded', () => {
    sync();
    for (const button of document.querySelectorAll('.theme-toggle'))
      button.addEventListener('click', toggle);
    film();
  });
  systemDark.addEventListener('change', sync);
})();
