import clsx from 'clsx';
import { Star } from 'lucide-react';
import type { Priority } from '@/domain/job';

export function Logo({ className }: { className?: string }) {
  return (
    <span className={clsx('flex items-center gap-2', className)}>
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <rect width="32" height="32" rx="8" className="fill-accent" />
        <rect x="7" y="8" width="5" height="16" rx="1.6" fill="white" opacity="0.95" />
        <rect x="13.5" y="8" width="5" height="11" rx="1.6" fill="white" opacity="0.75" />
        <rect x="20" y="8" width="5" height="7" rx="1.6" fill="white" opacity="0.55" />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight">Jobtrail</span>
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

export function Kbd({ children }: { children: string }) {
  return (
    <kbd className="text-subtle bg-surface-2 border-line rounded border px-1 font-sans text-[10px] font-medium">
      {children}
    </kbd>
  );
}
