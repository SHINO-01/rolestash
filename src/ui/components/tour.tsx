import clsx from 'clsx';
import { ArrowLeft, ArrowRight, Check, MousePointerClick, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { placeCard, type Box, type TourPlacement } from '../tour-placement';
import { Button, IconButton } from './button';

/**
 * A guided tour: a spotlight on one part of the page and a card that
 * explains it. Steps without a target sit in the middle of the window.
 * Interactive steps let clicks through to the page and move on by
 * themselves once their task is `done`. Skip, Close and Esc always end it.
 *
 * Targets are CSS selectors, usually `[data-tour~="<name>"]`. A modal <dialog> makes the
 * rest of the page inert, so while one is open the tour renders inside it.
 */

export type { TourPlacement };

export interface TourStepView {
  id: string;
  title: string;
  body: ReactNode;
  /** CSS selector of the element to spotlight; none, or not found, centres the card. */
  target?: string | undefined;
  /** A second element to ring inside the spotlight (the practice card on a busy board). */
  highlight?: string | undefined;
  placement?: TourPlacement | undefined;
  illustration?: ReactNode;
  /**
   * "Try it" task: clicks reach the page, and the step moves on once `done`.
   * `focus` is a selector for "Go to the card", so keyboard users can reach it.
   */
  task?: { label: string; done: boolean; focus?: string | undefined } | undefined;
  /** An extra button, e.g. "Set up autofill". */
  action?: { label: string; onClick: () => void } | undefined;
}

export type TourEnd = 'finished' | 'skipped';

const PAD = 6;
const MARGIN = 16;
const CARD_WIDTH = 368;

export function Tour({
  steps,
  index,
  onIndex,
  onEnd,
  startLabel,
  finishLabel = 'Finish',
  skipLabel = 'Skip tour',
  closeLabel = 'Close tour',
}: {
  steps: readonly TourStepView[];
  index: number;
  onIndex: (index: number) => void;
  onEnd: (how: TourEnd) => void;
  /** The first step's Next ("Start the tour"); without one it's Next. */
  startLabel?: string;
  finishLabel?: string;
  /** The text "Skip tour" link; null leaves only the ✕ (short guides). */
  skipLabel?: string | null;
  closeLabel?: string;
}) {
  const step = steps[index];
  const cardRef = useRef<HTMLDivElement>(null);
  const spotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const last = index === steps.length - 1;
  const first = index === 0;
  const layerRef = useRef<HTMLDivElement>(null);
  // One object for the whole tour: a new one each render would restart the
  // animation loop, and every step would jump instead of glide.
  const parts = useMemo(
    () => ({
      layer: layerRef,
      card: cardRef,
      spot: spotRef,
      ring: ringRef,
      highlight: highlightRef,
    }),
    [],
  );
  const host = useTourMotion(step, parts);
  // The layer fades in once; moving into a drawer (a new host) mustn't flash it again.
  const [faded, setFaded] = useState(false);

  // A new step: focus its title, so screen readers read it and Tab starts in the card.
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, [step?.id, host]);

  // A task finished on this step moves on after a moment, so the result is
  // seen. One already done when the step opened (after Back) waits for Next.
  const taskDone = step?.task?.done === true;
  const interactiveStep = step?.task !== undefined;
  const doneOnEntry = useRef(false);
  useEffect(() => {
    doneOnEntry.current = taskDone;
    // Only on a new step: a task done later in this step must still move on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.id]);
  useEffect(() => {
    if (!taskDone || doneOnEntry.current) return;
    const timer = setTimeout(() => (last ? onEnd('finished') : onIndex(index + 1)), 900);
    return () => clearTimeout(timer);
  }, [taskDone, index, last, onIndex, onEnd]);

  // Esc closes the tour (and nothing under it); arrows step when the card has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onEnd('skipped');
        return;
      }
      // Steps that only explain keep Tab inside the card: the page behind waits.
      // "Try it" steps let it out, so the keyboard can reach the card to move.
      if (e.key === 'Tab' && !interactiveStep && cardRef.current) {
        const items = [
          ...cardRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href]'),
        ];
        const firstItem = items[0];
        const lastItem = items.at(-1);
        const inside = cardRef.current.contains(document.activeElement);
        if (!inside || (e.shiftKey && document.activeElement === firstItem)) {
          e.preventDefault();
          (e.shiftKey ? lastItem : firstItem)?.focus();
        } else if (!e.shiftKey && document.activeElement === lastItem) {
          e.preventDefault();
          firstItem?.focus();
        }
        return;
      }
      if (!cardRef.current?.contains(e.target as Node)) return;
      if ((e.target as HTMLElement).closest('button') && (e.key === ' ' || e.key === 'Enter'))
        return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (last) onEnd('finished');
        else onIndex(index + 1);
      } else if (e.key === 'ArrowLeft' && !first) {
        e.preventDefault();
        onIndex(index - 1);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [index, first, last, interactiveStep, onIndex, onEnd]);

  if (!step) return null;
  const interactive = step.task !== undefined;

  return createPortal(
    <div
      ref={layerRef}
      className={clsx('pointer-events-none fixed inset-0 z-[60]', !faded && 'animate-fade-in')}
      onAnimationEnd={() => setFaded(true)}
      data-tour-layer=""
    >
      {/* One spotlight for every step (a centred step closes it to a point), moved
          by useTourMotion: it glides between steps and tracks its target exactly. */}
      <div ref={spotRef} aria-hidden className="tour-spotlight absolute top-0 left-0 rounded-xl" />
      <div
        ref={ringRef}
        aria-hidden
        className={clsx(
          'tour-ring absolute top-0 left-0',
          interactive && !taskDone && 'tour-ring-pulse',
        )}
      />
      <div
        ref={highlightRef}
        aria-hidden
        className={clsx(
          'tour-ring tour-ring-strong absolute top-0 left-0',
          step.highlight && !taskDone && 'tour-ring-pulse',
        )}
      />
      {/* Outside an interactive step, the page waits: clicks land on this shield. */}
      {interactive ? null : <div className="pointer-events-auto absolute inset-0" />}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal={interactive ? 'false' : 'true'}
        aria-labelledby={`tour-title-${step.id}`}
        aria-describedby={`tour-body-${step.id}`}
        className="bg-surface text-ink border-line shadow-pop pointer-events-auto absolute top-0 left-0 overflow-hidden rounded-2xl border opacity-0 transition-opacity duration-150"
        style={{ width: `min(${String(CARD_WIDTH)}px, calc(100vw - ${String(MARGIN * 2)}px))` }}
      >
        <div key={step.id} className="tour-step-in flex flex-col">
          <div className="flex items-center gap-3 px-4 pt-3.5">
            <div
              className="bg-surface-3 h-1 flex-1 overflow-hidden rounded-full"
              role="progressbar"
              aria-label="Tour progress"
              aria-valuemin={1}
              aria-valuemax={steps.length}
              aria-valuenow={index + 1}
            >
              <div
                className="bg-accent h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${String(((index + 1) / steps.length) * 100)}%` }}
              />
            </div>
            <span className="text-subtle text-xs tabular-nums">
              {index + 1} of {steps.length}
            </span>
            <IconButton size="sm" label={closeLabel} onClick={() => onEnd('skipped')}>
              <X className="size-4" />
            </IconButton>
          </div>

          {step.illustration ? (
            <div className="bg-surface-2 border-line mx-4 mt-3 overflow-hidden rounded-xl border">
              {step.illustration}
            </div>
          ) : null}

          <div className="px-4 pt-3 pb-1">
            <h2
              ref={titleRef}
              id={`tour-title-${step.id}`}
              tabIndex={-1}
              className="text-[15px] leading-snug font-semibold tracking-tight outline-none"
            >
              {step.title}
            </h2>
            <div
              id={`tour-body-${step.id}`}
              className="text-muted mt-1.5 flex flex-col gap-2 text-[13px] leading-relaxed"
            >
              {step.body}
            </div>
          </div>

          {step.task ? (
            <div
              className={clsx(
                'mx-4 mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium',
                taskDone
                  ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
                  : 'bg-accent-soft text-accent-ink',
              )}
            >
              {taskDone ? (
                <Check aria-hidden className="size-4 shrink-0" strokeWidth={3} />
              ) : (
                <MousePointerClick aria-hidden className="size-4 shrink-0" />
              )}
              <span role="status" className="flex-1">
                {taskDone ? 'Nice, that’s it.' : `Try it: ${step.task.label}`}
              </span>
              {!taskDone && step.task.focus ? (
                <button
                  type="button"
                  className="text-accent-ink min-h-6 shrink-0 rounded-md px-1.5 text-xs font-semibold underline underline-offset-2"
                  onClick={() => {
                    const selector = step.task?.focus;
                    if (selector) document.querySelector<HTMLElement>(selector)?.focus();
                  }}
                >
                  Go to the card
                </button>
              ) : null}
            </div>
          ) : null}

          {step.action ? (
            <div className="px-4 pt-2">
              <Button size="sm" variant="secondary" onClick={step.action.onClick}>
                {step.action.label}
              </Button>
            </div>
          ) : null}

          <div className="mt-3 flex items-center gap-2 px-4 pb-4">
            {last || skipLabel === null ? null : (
              <button
                type="button"
                onClick={() => onEnd('skipped')}
                className="text-muted hover:text-ink rounded-md px-1 py-1 text-[13px] font-medium underline-offset-2 hover:underline"
              >
                {skipLabel}
              </button>
            )}
            <div className="flex-1" />
            {first ? null : (
              <Button
                size="sm"
                variant="ghost"
                icon={<ArrowLeft className="size-4" />}
                onClick={() => onIndex(index - 1)}
              >
                Back
              </Button>
            )}
            <Button
              size="sm"
              variant={interactive && !taskDone ? 'secondary' : 'primary'}
              onClick={() => (last ? onEnd('finished') : onIndex(index + 1))}
            >
              {first && startLabel
                ? startLabel
                : last
                  ? finishLabel
                  : interactive && !taskDone
                    ? 'Skip step'
                    : 'Next'}
              {last ? null : <ArrowRight className="size-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    host ?? document.body,
  );
}

/** How long the spotlight and card glide to a new step. */
const GLIDE_MS = 320;

interface TourParts {
  layer: React.RefObject<HTMLDivElement | null>;
  card: React.RefObject<HTMLDivElement | null>;
  spot: React.RefObject<HTMLDivElement | null>;
  ring: React.RefObject<HTMLDivElement | null>;
  highlight: React.RefObject<HTMLDivElement | null>;
}

interface Frame {
  spot: Box;
  /** 1 when there's a target to ring, 0 for a centred step. */
  ring: number;
  highlight: Box | undefined;
  card: { top: number; left: number } | undefined;
}

/**
 * Where to render (the topmost modal dialog when one is open, since it makes
 * everything else inert; else the body) and the motion: one animation-frame
 * loop places the spotlight, rings and card straight on the DOM, no React
 * renders per frame. A new step glides for GLIDE_MS (ease-out); after that
 * everything tracks its target exactly, so scrolling or a drawer sliding in
 * never makes it lag or wobble. Reduced motion jumps instead.
 */
function useTourMotion(step: TourStepView | undefined, refs: TourParts): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const live = useRef(step);
  useEffect(() => {
    live.current = step;
  }, [step]);

  useEffect(() => {
    let frame = 0;
    let stepId: string | undefined;
    let shown: Frame | undefined;
    let from: Frame | undefined;
    let start = 0;
    let scrolled = false;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const find = (selector: string | undefined) =>
      selector
        ? [...document.querySelectorAll<HTMLElement>(selector)].find(
            (e) => e.getClientRects().length > 0,
          )
        : undefined;
    const measure = (el: HTMLElement | undefined) => {
      const r = el?.getBoundingClientRect();
      return r && r.width > 0 && r.height > 0
        ? clip({ top: r.top, left: r.left, width: r.width, height: r.height })
        : undefined;
    };

    const tick = (now: number) => {
      const current = live.current;
      const modals = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].filter((d) =>
        d.matches(':modal'),
      );
      const top = modals.at(-1) ?? null;
      setHost((h) => (h === top ? h : top));

      if (current && current.id !== stepId) {
        stepId = current.id;
        from = shown;
        start = now;
        scrolled = false;
      }
      const el = find(current?.target);
      const ringed = find(current?.highlight);
      // On a busy board what the step is about may be scrolled away: bring it
      // into view once, smoothly; the spotlight follows it there.
      if (!scrolled && (ringed ?? el)) {
        scrolled = true;
        (ringed ?? el)?.scrollIntoView({
          block: 'nearest',
          inline: 'nearest',
          behavior: reduced ? 'auto' : 'smooth',
        });
      }
      const target = measure(el);
      const hole = target ? inflate(target, PAD) : undefined;
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const cardEl = refs.card.current;
      const size = cardEl ? { width: cardEl.offsetWidth, height: cardEl.offsetHeight } : undefined;
      const ringBox = measure(ringed);
      const goal: Frame = {
        spot: hole ?? { top: viewport.height / 2, left: viewport.width / 2, width: 0, height: 0 },
        ring: hole ? 1 : 0,
        highlight: ringBox ? inflate(ringBox, PAD) : undefined,
        card:
          size && size.width > 0
            ? placeCard(hole, size, current?.placement ?? 'bottom', viewport)
            : undefined,
      };
      const t = reduced || !from ? 1 : Math.min(1, (now - start) / GLIDE_MS);
      shown = t < 1 && from ? mix(from, goal, 1 - (1 - t) ** 3) : goal;
      // Inside a drawer that's still sliding in, "fixed" is relative to the
      // drawer, not the window: measure where the layer really is, and offset.
      const layer = refs.layer.current?.getBoundingClientRect();
      paint(shown, refs, { top: layer?.top ?? 0, left: layer?.left ?? 0 });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [refs]);

  return host;
}

function mix(a: Frame, b: Frame, e: number): Frame {
  const n = (x: number, y: number) => x + (y - x) * e;
  const box = (x: Box, y: Box): Box => ({
    top: n(x.top, y.top),
    left: n(x.left, y.left),
    width: n(x.width, y.width),
    height: n(x.height, y.height),
  });
  return {
    spot: box(a.spot, b.spot),
    ring: n(a.ring, b.ring),
    highlight: a.highlight && b.highlight ? box(a.highlight, b.highlight) : b.highlight,
    card:
      a.card && b.card
        ? { top: n(a.card.top, b.card.top), left: n(a.card.left, b.card.left) }
        : b.card,
  };
}

/** Writes a frame to the DOM; only what changed is touched. */
function paint(f: Frame, refs: TourParts, offset: { top: number; left: number }): void {
  const set = (
    el: HTMLElement | null,
    prop: 'transform' | 'width' | 'height' | 'opacity',
    v: string,
  ) => {
    if (el && el.style[prop] !== v) el.style[prop] = v;
  };
  const place = (el: HTMLElement | null, b: Box) => {
    set(
      el,
      'transform',
      `translate3d(${(b.left - offset.left).toFixed(1)}px, ${(b.top - offset.top).toFixed(1)}px, 0)`,
    );
    set(el, 'width', `${b.width.toFixed(1)}px`);
    set(el, 'height', `${b.height.toFixed(1)}px`);
  };
  place(refs.spot.current, f.spot);
  place(refs.ring.current, f.spot);
  set(refs.ring.current, 'opacity', f.ring.toFixed(2));
  if (f.highlight) place(refs.highlight.current, f.highlight);
  set(refs.highlight.current, 'opacity', f.highlight ? '1' : '0');
  if (f.card) {
    set(
      refs.card.current,
      'transform',
      `translate3d(${(f.card.left - offset.left).toFixed(1)}px, ${(f.card.top - offset.top).toFixed(1)}px, 0)`,
    );
    set(refs.card.current, 'opacity', '1');
  }
}

function inflate(box: Box, by: number): Box {
  return {
    top: box.top - by,
    left: box.left - by,
    width: box.width + by * 2,
    height: box.height + by * 2,
  };
}

/** Keeps a tall target (the whole board) inside the window. */
function clip(box: Box): Box {
  const top = Math.max(box.top, PAD);
  const left = Math.max(box.left, PAD);
  const bottom = Math.min(box.top + box.height, window.innerHeight - PAD);
  const right = Math.min(box.left + box.width, window.innerWidth - PAD);
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}
