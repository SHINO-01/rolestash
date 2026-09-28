import clsx from 'clsx';
import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

const CONTROL =
  'w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-subtle transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15';

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { warn?: boolean }
>(function Input({ className, warn, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={clsx(
        CONTROL,
        'h-9',
        warn && 'border-amber-400 dark:border-amber-500/60',
        className,
      )}
      {...rest}
    />
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={clsx(CONTROL, 'min-h-24 py-2 leading-relaxed', className)}
      {...rest}
    />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select ref={ref} className={clsx(CONTROL, 'h-9 appearance-auto pr-2', className)} {...rest}>
        {children}
      </select>
    );
  },
);

export interface FieldProps {
  label: string;
  hint?: ReactNode;
  children: (id: string) => ReactNode;
  className?: string;
}

/** Label + control + optional hint, with accessible wiring via render prop. */
export function Field({ label, hint, children, className }: FieldProps) {
  const id = useId();
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-muted text-xs font-medium">
        {label}
      </label>
      {children(id)}
      {hint ? <div className="text-subtle text-xs">{hint}</div> : null}
    </div>
  );
}
