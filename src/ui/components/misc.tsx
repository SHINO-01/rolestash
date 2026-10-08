import clsx from 'clsx';
import { Star } from 'lucide-react';
import type { Priority } from '@/domain/job';

/** The Rolestash mark (brand/rolestash-mark.svg) plus wordmark. Brand colours are fixed. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={clsx('flex items-center gap-2', className)}>
      <svg viewBox="0 0 128 128" className="size-7" aria-hidden>
        <rect width="128" height="128" rx="30" fill="#0B5D52" />
        <rect
          x="52"
          y="26"
          width="38"
          height="50"
          rx="7"
          fill="#CFE6DF"
          transform="rotate(12 71 51)"
        />
        <g transform="rotate(-9 64 52)">
          <rect x="43" y="18" width="42" height="58" rx="7" fill="#F4B63F" />
          <rect x="51" y="29" width="22" height="5" rx="2.5" fill="#8A5A12" />
          <rect x="51" y="39" width="14" height="5" rx="2.5" fill="#8A5A12" />
        </g>
        <path
          d="M28 62H100V84Q100 92 93 96L68 109Q64 111 60 109L35 96Q28 92 28 84Z"
          fill="#FFF7E6"
          stroke="#FFF7E6"
          strokeWidth="4"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight">
        role<span className="text-accent">stash</span>
      </span>
    </span>
  );
}

export function PriorityInput({
  value,
  onChange,
}: {
  value: Priority;
  onChange: (value: Priority) => void;
}) {
  return (
    <div className="flex items-center gap-0.5" role="radiogroup" aria-label="Priority">
      {([1, 2, 3] as const).map((level) => (
        <button
          key={level}
          type="button"
          role="radio"
          aria-checked={value === level}
          aria-label={`Priority ${level} of 3`}
          onClick={() => onChange(value === level ? 0 : level)}
          className="hover:bg-surface-2 rounded-md p-1"
        >
          <Star
            className={clsx(
              'size-4 transition-colors',
              level <= value ? 'fill-amber-400 text-amber-400' : 'text-line-strong',
            )}
          />
        </button>
      ))}
    </div>
  );
}

export function PriorityBadge({ value }: { value: Priority }) {
  if (value === 0) return null;
  return (
    <span className="inline-flex items-center gap-px" aria-label={`Priority ${value} of 3`}>
      {Array.from({ length: value }, (_, i) => (
        <Star key={i} className="size-3 fill-amber-400 text-amber-400" />
      ))}
    </span>
  );
}

export function Kbd({ children, large = false }: { children: string; large?: boolean }) {
  return (
    <kbd
      className={clsx(
        'text-muted bg-surface-2 border-line rounded border font-sans font-medium',
        large ? 'min-w-6 px-1.5 py-0.5 text-center text-xs' : 'px-1 text-[10px]',
      )}
    >
      {children}
    </kbd>
  );
}
