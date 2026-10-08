import { Compass, MousePointerClick, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/ui/components/button';
import { Kbd } from '@/ui/components/misc';

const STEPS: { title: string; body: ReactNode }[] = [
  {
    title: 'Open a job posting',
    body: 'On LinkedIn, Seek, Indeed or any of the 50 job sites Rolestash knows.',
  },
  {
    title: 'Click Save job',
    body: (
      <>
        The button at the edge of the page. Or press <Kbd>Alt+J</Kbd>.
      </>
    ),
  },
  {
    title: 'Track it here',
    body: 'Drag the card across the lanes as you apply, interview and hear back.',
  },
];

export function EmptyBoard({ onAdd, onTour }: { onAdd: () => void; onTour: () => void }) {
  return (
    <div className="flex h-full items-center justify-center overflow-y-auto px-6 pb-16">
      <div className="flex max-w-2xl flex-col items-center text-center">
        <div className="relative mb-6 flex gap-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="bg-surface-2 flex w-20 flex-col gap-1.5 rounded-xl p-2"
              style={{ opacity: 1 - i * 0.25 }}
            >
              {Array.from({ length: 3 - i }, (_, k) => (
                <div key={k} className="bg-surface shadow-card border-line h-6 rounded-md border" />
              ))}
            </div>
          ))}
        </div>
        <h1 className="text-xl font-semibold tracking-tight">
          Your board is ready for its first job
        </h1>
        <p className="text-muted mt-2 text-sm">Saving a job takes one click:</p>
        <ol className="mt-5 grid w-full gap-3 text-left sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <li
              key={step.title}
              className="bg-surface border-line shadow-card rounded-xl border p-4"
            >
              <span className="bg-accent-soft text-accent-ink flex size-6 items-center justify-center rounded-full text-xs font-semibold">
                {i + 1}
              </span>
              <p className="text-ink mt-2.5 text-sm font-semibold">{step.title}</p>
              <p className="text-muted mt-1 text-[13px] leading-relaxed">{step.body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button variant="primary" icon={<Compass className="size-4" />} onClick={onTour}>
            Take the 2-minute tour
          </Button>
          <Button icon={<Plus className="size-4" />} onClick={onAdd}>
            Add a job yourself
          </Button>
        </div>
        <p className="text-subtle mt-8 flex items-center gap-1.5 text-xs">
          <MousePointerClick className="size-3.5" /> Your jobs are saved in this browser first.
          Accounts and sync are optional.
        </p>
      </div>
    </div>
  );
}
