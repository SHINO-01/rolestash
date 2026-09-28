import clsx from 'clsx';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  checked?: boolean;
  tone?: 'default' | 'danger';
}

export type MenuEntry = MenuItem | 'separator' | { heading: string };

/** Lightweight dropdown menu with keyboard support (Esc closes, arrows move). */
export function Menu({
  trigger,
  items,
  align = 'end',
}: {
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean }) => ReactNode;
  items: MenuEntry[];
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const buttons = [
          ...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
        ];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === 'ArrowDown' ? index + 1 : index - 1;
        buttons[(next + buttons.length) % buttons.length]?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      {trigger({ onClick: () => setOpen((o) => !o), 'aria-expanded': open })}
      {open ? (
        <div
          role="menu"
          className={clsx(
            'animate-fade-in bg-surface shadow-lift border-line absolute top-full z-40 mt-1.5 min-w-52 rounded-xl border p-1',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item, i) => {
            if (item === 'separator') return <div key={i} className="border-line my-1 border-t" />;
            if ('heading' in item)
              return (
                <div
                  key={i}
                  className="text-subtle px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide uppercase"
                >
                  {item.heading}
                </div>
              );
            return (
              <button
                key={i}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={clsx(
                  'hover:bg-surface-2 focus:bg-surface-2 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm outline-none',
                  item.tone === 'danger' ? 'text-rose-600 dark:text-rose-400' : 'text-ink',
                )}
              >
                <span className="text-muted flex size-4 items-center justify-center">
                  {item.icon}
                </span>
                <span className="flex-1">{item.label}</span>
                {item.checked ? <span className="bg-accent size-1.5 rounded-full" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
