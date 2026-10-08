import clsx from 'clsx';
import { ArrowLeft, ArrowRight, Check, MousePointerClick, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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
  const { host, rect, highlight } = useTourGeometry(step?.target, step?.highlight);
  const cardRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [card, setCard] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const last = index === steps.length - 1;
  const first = index === 0;

  // The card's own size, for placing it beside the target.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const measure = () => setCard({ width: el.offsetWidth, height: el.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [host, step?.id]);

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
  const hole = rect ? inflate(rect, PAD) : undefined;
  const position = placeCard(hole, card, step.placement ?? 'bottom', {
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const interactive = step.task !== undefined;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[60]" data-tour-layer="">
      {hole ? (
        <div
          aria-hidden
          className={clsx(
            'tour-spotlight absolute rounded-xl',
            interactive && !taskDone && 'tour-pulse',
          )}
          style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
        />
      ) : (
        <div aria-hidden className="animate-fade-in absolute inset-0 bg-zinc-950/55" />
      )}
      {highlight ? (
        <div
          aria-hidden
          className={clsx('tour-highlight absolute rounded-xl', !taskDone && 'tour-pulse-ring')}
          style={{
            top: highlight.top - PAD,
            left: highlight.left - PAD,
            width: highlight.width + PAD * 2,
            height: highlight.height + PAD * 2,
          }}
        />
      ) : null}
      {/* Outside an interactive step, the page waits: clicks land on this shield. */}
      {interactive ? null : <div className="pointer-events-auto absolute inset-0" />}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal={interactive ? 'false' : 'true'}
        aria-labelledby={`tour-title-${step.id}`}
        aria-describedby={`tour-body-${step.id}`}
        className="bg-surface text-ink border-line shadow-pop animate-rise pointer-events-auto absolute flex flex-col overflow-hidden rounded-2xl border"
        style={{
          top: position.top,
          left: position.left,
          width: `min(${String(CARD_WIDTH)}px, calc(100vw - ${String(MARGIN * 2)}px))`,
          visibility: card.width ? 'visible' : 'hidden',
        }}
        key={step.id}
      >
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
    </div>,
    host ?? document.body,
  );
}

/**
 * Where the target is, and where to render: the topmost modal dialog when
 * one is open (everything else is inert), else the body. Polled each frame
 * while the tour is up, so scrolling, resizing and opening a drawer all follow.
 */
function useTourGeometry(
  target: string | undefined,
  ring: string | undefined,
): {
  host: HTMLElement | null;
  rect: Box | undefined;
  highlight: Box | undefined;
} {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [rect, setRect] = useState<Box | undefined>();
  const [highlight, setHighlight] = useState<Box | undefined>();
  useEffect(() => {
    let frame = 0;
    // On a busy board what the step is about may be scrolled away: bring it
    // into view once, when it's first found.
    let scrolled = false;
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
    const tick = () => {
      const modals = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].filter((d) =>
        d.matches(':modal'),
      );
      const top = modals.at(-1) ?? null;
      setHost((current) => (current === top ? current : top));
      const el = find(target);
      const ringed = find(ring);
      if (!scrolled && (ringed ?? el)) {
        scrolled = true;
        (ringed ?? el)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      const next = measure(el);
      const nextRing = measure(ringed);
      setRect((current) => (sameBox(current, next) ? current : next));
      setHighlight((current) => (sameBox(current, nextRing) ? current : nextRing));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [target, ring]);
  return { host, rect, highlight };
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

function sameBox(a: Box | undefined, b: Box | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}
