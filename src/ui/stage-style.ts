import type { StageColor } from '@/domain/stage';

/**
 * Static class names per stage color (Tailwind only generates classes it can
 * see literally in source, so these can't be built with string templates).
 */
export const STAGE_STYLE: Record<StageColor, { dot: string; chip: string; bar: string }> = {
  slate: {
    dot: 'bg-slate-400',
    chip: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300',
    bar: 'bg-slate-400',
  },
  sky: {
    dot: 'bg-sky-500',
    chip: 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
    bar: 'bg-sky-500',
  },
  violet: {
    dot: 'bg-violet-500',
    chip: 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
    bar: 'bg-violet-500',
  },
  amber: {
    dot: 'bg-amber-500',
    chip: 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
    bar: 'bg-amber-500',
  },
  emerald: {
    dot: 'bg-emerald-500',
    chip: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    bar: 'bg-emerald-500',
  },
  rose: {
    dot: 'bg-rose-500',
    chip: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
    bar: 'bg-rose-500',
  },
  zinc: {
    dot: 'bg-zinc-400',
    chip: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-500/15 dark:text-zinc-400',
    bar: 'bg-zinc-400',
  },
};
