import clsx from 'clsx';
import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { IconButton } from './button';

/**
 * Modal dialog and side drawer built on the native <dialog> element, which
 * gives us focus trapping, Esc-to-close and top-layer rendering for free.
 */

function useNativeDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [onClose]);
  return ref;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const ref = useNativeDialog(open, onClose);
  const titleId = useId();
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClick={(e) => e.target === ref.current && onClose()}
      className={clsx(
        'bg-surface text-ink shadow-pop border-line open:animate-fade-in m-auto w-[min(520px,calc(100vw-2rem))] rounded-2xl border p-0 backdrop:bg-zinc-950/40 backdrop:backdrop-blur-[2px]',
        className,
      )}
    >
      {open ? (
        <div className="flex flex-col">
          <header className="flex items-start justify-between gap-4 px-5 pt-5">
            <div>
              <h2 id={titleId} className="text-base font-semibold">
                {title}
              </h2>
              {description ? <p className="text-muted mt-1 text-sm">{description}</p> : null}
            </div>
            <IconButton label="Close" size="sm" onClick={onClose}>
              <X className="size-4" />
            </IconButton>
          </header>
          <div className="px-5 py-4">{children}</div>
          {footer ? (
            <footer className="bg-surface-2/60 border-line flex justify-end gap-2 rounded-b-2xl border-t px-5 py-3">
              {footer}
            </footer>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}

export function Drawer({
  open,
  onClose,
  children,
  label,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  label: string;
}) {
  const ref = useNativeDialog(open, onClose);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      onClick={(e) => e.target === ref.current && onClose()}
      className="bg-surface text-ink shadow-pop open:animate-slide-in border-line fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-[min(560px,100vw)] max-w-none border-l p-0 backdrop:bg-zinc-950/25"
    >
      {open ? children : null}
    </dialog>
  );
}
