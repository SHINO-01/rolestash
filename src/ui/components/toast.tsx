import clsx from 'clsx';
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type Tone = 'success' | 'info' | 'error';

export interface ToastOptions {
  message: string;
  tone?: Tone;
  action?: { label: string; onClick: () => void };
  durationMs?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
}

const ToastContext = createContext<(options: ToastOptions) => void>(() => undefined);

export function useToast() {
  return useContext(ToastContext);
}

const ICONS: Record<Tone, ReactNode> = {
  success: <CheckCircle2 className="size-4 text-emerald-500" />,
  info: <Info className="text-accent size-4" />,
  error: <TriangleAlert className="size-4 text-rose-500" />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const show = useCallback(
    (options: ToastOptions) => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-2), { ...options, id }]);
      setTimeout(() => dismiss(id), options.durationMs ?? 5000);
    },
    [dismiss],
  );

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={clsx(
              'animate-fade-in border-line bg-surface shadow-lift pointer-events-auto flex items-center gap-3 rounded-xl border py-2.5 pr-2 pl-3.5 text-sm',
            )}
          >
            {ICONS[t.tone ?? 'info']}
            <span>{t.message}</span>
            {t.action ? (
              <button
                type="button"
                className="text-accent hover:bg-accent-soft rounded-md px-2 py-1 text-sm font-semibold"
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Dismiss"
              className="text-subtle hover:text-ink rounded-md p-1"
              onClick={() => dismiss(t.id)}
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
