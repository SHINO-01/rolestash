import { ArrowRight, Pin, Puzzle } from 'lucide-react';
import type { StageColor } from '@/domain/stage';
import { STAGE_STYLE } from '@/ui/stage-style';

/**
 * Small drawings for the tour's centred steps: what happens off the board
 * (on a job site, in Chrome's toolbar), where there is nothing to spotlight.
 * Decorative only; the step's text says the same.
 */

const LANES: { name: string; color: StageColor; cards: number }[] = [
  { name: 'Saved', color: 'slate', cards: 3 },
  { name: 'Applied', color: 'sky', cards: 2 },
  { name: 'Interviewing', color: 'amber', cards: 1 },
  { name: 'Offer', color: 'emerald', cards: 1 },
  { name: 'Rejected', color: 'rose', cards: 0 },
];

/** The board in miniature, a card on its way from Saved to Applied. */
export function BoardArt() {
  return (
    <div aria-hidden className="relative flex h-32 items-start gap-1.5 px-3 pt-3">
      {LANES.map((lane) => (
        <div
          key={lane.name}
          className="bg-surface-3/60 flex min-w-0 flex-1 flex-col gap-1 rounded-lg p-1.5"
        >
          <div className="flex items-center gap-1">
            <span className={`size-1.5 shrink-0 rounded-full ${STAGE_STYLE[lane.color].dot}`} />
            <span className="text-muted truncate text-[9px] font-semibold">{lane.name}</span>
          </div>
          {Array.from({ length: lane.cards }, (_, i) => (
            <div key={i} className="bg-surface border-line h-5 rounded border shadow-sm" />
          ))}
        </div>
      ))}
      <div className="bg-surface border-accent shadow-lift absolute top-14 left-[19%] h-5 w-[17%] rotate-[-4deg] rounded border-2" />
      <ArrowRight className="text-accent absolute top-[60px] left-[37%] size-3.5" />
    </div>
  );
}

/** A job posting in a browser, the Save job button at its edge and the panel it opens. */
export function CaptureArt() {
  return (
    <div aria-hidden className="relative h-36 p-3">
      <div className="bg-surface border-line flex h-full flex-col overflow-hidden rounded-lg border">
        <div className="border-line flex items-center gap-1.5 border-b px-2 py-1.5">
          <span className="size-1.5 rounded-full bg-rose-400" />
          <span className="size-1.5 rounded-full bg-amber-400" />
          <span className="size-1.5 rounded-full bg-emerald-400" />
          <span className="bg-surface-2 text-subtle ml-2 flex-1 truncate rounded px-2 py-0.5 text-[9px]">
            jobs.example.com/frontend-engineer
          </span>
        </div>
        <div className="flex flex-1 flex-col gap-1.5 p-2.5">
          <div className="bg-ink/80 h-2 w-1/2 rounded" />
          <div className="bg-surface-3 h-1.5 w-1/3 rounded" />
          <div className="bg-surface-3 mt-1 h-1.5 w-[55%] rounded" />
          <div className="bg-surface-3 h-1.5 w-[48%] rounded" />
          <div className="bg-surface-3 h-1.5 w-[52%] rounded" />
        </div>
      </div>
      {/* The panel, as the button opens it. */}
      <div className="bg-surface border-line shadow-lift absolute right-6 bottom-5 flex w-[42%] flex-col gap-1 rounded-lg border p-2">
        <div className="bg-ink/80 h-1.5 w-3/4 rounded" />
        <div className="bg-surface-3 h-1.5 w-1/2 rounded" />
        <div className="mt-0.5 flex gap-1">
          <span className={`h-2 w-6 rounded-full ${STAGE_STYLE.slate.chip}`} />
          <span className={`h-2 w-6 rounded-full ${STAGE_STYLE.sky.chip}`} />
        </div>
        <div className="bg-accent mt-0.5 flex h-4 items-center justify-center rounded text-[8px] font-semibold text-white dark:text-zinc-950">
          Save job
        </div>
      </div>
      {/* The button at the edge of the page; brand colours are fixed. */}
      <div className="absolute top-8 right-1 flex items-center gap-1 rounded-l-xl bg-[#0B5D52] py-1 pr-2 pl-1.5 text-[9px] font-semibold text-[#FFF7E6] shadow-md">
        <span className="size-3 rounded-[4px] bg-[#F4B63F]" />
        Save job
      </div>
    </div>
  );
}

/** Chrome's toolbar: the puzzle piece, and the pin next to Rolestash. */
export function PinArt() {
  return (
    <div aria-hidden className="relative h-32 p-3">
      <div className="bg-surface border-line flex items-center gap-2 rounded-lg border px-2 py-1.5">
        <span className="bg-surface-2 text-subtle flex-1 truncate rounded px-2 py-0.5 text-[9px]">
          seek.com.au
        </span>
        <span className="ring-accent text-ink flex size-5 items-center justify-center rounded-md ring-2">
          <Puzzle className="size-3.5" />
        </span>
        <span className="bg-surface-3 size-4 rounded-full" />
      </div>
      <div className="bg-surface border-line shadow-lift absolute top-11 right-8 w-[62%] rounded-lg border p-1.5">
        <p className="text-subtle px-1 pb-1 text-[9px] font-semibold">Extensions</p>
        <div className="bg-surface-2 flex items-center gap-1.5 rounded-md px-1.5 py-1">
          <span className="size-3.5 rounded-[4px] bg-[#0B5D52]" />
          <span className="text-ink flex-1 text-[10px] font-medium">Rolestash</span>
          <span className="bg-accent flex size-4 items-center justify-center rounded text-white dark:text-zinc-950">
            <Pin className="size-2.5" />
          </span>
        </div>
        <div className="flex items-center gap-1.5 px-1.5 py-1 opacity-50">
          <span className="bg-surface-3 size-3.5 rounded-[4px]" />
          <span className="bg-surface-3 h-1.5 flex-1 rounded" />
        </div>
      </div>
    </div>
  );
}
