import { ArrowRight, Lightbulb, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  autoStartAllowed,
  E2E_AUTO_START_KEY,
  WIDGET_GUIDE_KEY,
} from '@/features/tour/board-tour-steps';
import { Button, IconButton } from '@/ui/components/button';
import { useServices } from '@/ui/hooks/services';

/** What the widget's first-run guide points at, step by step. */
export type GuideTarget = 'found' | 'lane' | 'save';

const STEPS: { target: GuideTarget; title: string; body: string }[] = [
  {
    target: 'found',
    title: 'This is the job on this page',
    body: 'Rolestash read the title, company, place and pay. If anything looks wrong, click Edit details.',
  },
  {
    target: 'lane',
    title: 'Pick a lane',
    body: 'Saved is for jobs you’ll apply to later. Choose Applied if you’ve already sent your application.',
  },
  {
    target: 'save',
    title: 'Save it to your board',
    body: 'Your board has a lane for every step. Open it with the Board button at the top. Esc closes this panel.',
  },
];

/**
 * A three-step guide the first time the widget shows a job (ADR-0039),
 * inline above it: the panel is sized to its content, so nothing floats.
 * Skip and Close end it for good; so does finishing it.
 */
export function useWidgetGuide(ready: boolean): {
  target: GuideTarget | undefined;
  element: ReactNode;
} {
  const { store } = useServices();
  const [seen, setSeen] = useState<boolean>(true);
  const [index, setIndex] = useState(0);
  const titleRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    void store
      .get([WIDGET_GUIDE_KEY, E2E_AUTO_START_KEY])
      .then((s) =>
        setSeen(s[WIDGET_GUIDE_KEY] !== undefined || !autoStartAllowed(import.meta.env.MODE, s)),
      );
  }, [store]);

  const show = ready && !seen;
  const step = STEPS[index];
  // Focus follows Next and Back (not the first step: the page keeps focus as the panel opens).
  useEffect(() => {
    if (index > 0) titleRef.current?.focus({ preventScroll: true });
  }, [index]);

  const end = (how: 'finished' | 'skipped') => {
    setSeen(true);
    void store.set({ [WIDGET_GUIDE_KEY]: { status: how, at: new Date().toISOString() } });
  };

  if (!show || !step) return { target: undefined, element: null };
  const last = index === STEPS.length - 1;
  return {
    target: step.target,
    element: (
      <section
        aria-label="Quick guide"
        className="bg-accent-soft text-accent-ink animate-rise flex flex-col gap-1.5 rounded-xl p-3"
      >
        <div className="flex items-center gap-2">
          <Lightbulb className="size-3.5 shrink-0" />
          <span className="flex-1 text-[11px] font-semibold tracking-wide uppercase">
            Quick guide · {index + 1} of {STEPS.length}
          </span>
          <IconButton
            size="sm"
            label="Close guide"
            className="text-accent-ink hover:bg-surface/60 size-6"
            onClick={() => end('skipped')}
          >
            <X className="size-3.5" />
          </IconButton>
        </div>
        <p ref={titleRef} tabIndex={-1} className="text-sm font-semibold outline-none">
          {step.title}
        </p>
        <p className="text-[13px] leading-relaxed opacity-90">{step.body}</p>
        <div className="mt-1 flex items-center gap-2">
          {last ? null : (
            <button
              type="button"
              onClick={() => end('skipped')}
              className="text-[13px] font-medium underline-offset-2 opacity-80 hover:underline hover:opacity-100"
            >
              Skip
            </button>
          )}
          <div className="flex-1" />
          {index > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => setIndex(index - 1)}>
              Back
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="primary"
            onClick={() => (last ? end('finished') : setIndex(index + 1))}
          >
            {last ? 'Got it' : 'Next'}
            {last ? null : <ArrowRight className="size-3.5" />}
          </Button>
        </div>
      </section>
    ),
  };
}
