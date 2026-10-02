import { MousePointerClick, Plus } from 'lucide-react';
import { Button } from '@/ui/components/button';
import { Kbd } from '@/ui/components/misc';

export function EmptyBoard({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex h-full items-center justify-center px-6 pb-16">
      <div className="flex max-w-md flex-col items-center text-center">
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
        <h1 className="text-xl font-semibold tracking-tight">Your job board is empty</h1>
        <p className="text-muted mt-2 text-sm leading-relaxed">
          Open any job posting and click the Rolestash icon in your toolbar, press <Kbd>Alt+J</Kbd>,
          or right-click the page and choose{' '}
          <span className="text-ink font-medium">Track this job</span>.
        </p>
        <div className="mt-6 flex gap-2">
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={onAdd}>
            Add a job manually
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
