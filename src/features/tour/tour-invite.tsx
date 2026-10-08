import { Compass, X } from 'lucide-react';
import { Button, IconButton } from '@/ui/components/button';

/**
 * The tour, offered: a card in the corner that leaves the board usable, for
 * people who already have jobs on it.
 */
export function TourInvite({ onStart, onDecline }: { onStart: () => void; onDecline: () => void }) {
  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby="tour-invite-title"
      className="bg-surface text-ink border-line shadow-pop animate-rise fixed right-4 bottom-4 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2 rounded-2xl border p-4"
    >
      <div className="flex items-start gap-3">
        <span className="bg-accent-soft text-accent-ink flex size-9 shrink-0 items-center justify-center rounded-full">
          <Compass className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="tour-invite-title" className="text-[15px] font-semibold tracking-tight">
            New: a tour of everything Rolestash does
          </h2>
          <p className="text-muted mt-1 text-[13px] leading-relaxed">
            Two minutes, every feature, with a practice card to try things on. Your own jobs stay
            exactly as they are.
          </p>
        </div>
        <IconButton size="sm" label="Close" onClick={onDecline}>
          <X className="size-4" />
        </IconButton>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDecline}>
          Not now
        </Button>
        <Button size="sm" variant="primary" onClick={onStart}>
          Take the tour
        </Button>
      </div>
    </section>
  );
}
