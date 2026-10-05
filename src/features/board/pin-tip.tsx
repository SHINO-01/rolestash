import { Pin, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isPinned } from '@/platform/widget';
import { IconButton } from '@/ui/components/button';
import { useServices } from '@/ui/hooks/services';

const DISMISSED_KEY = 'tips:pinDismissed';

/**
 * "Pin Rolestash" until the icon is on the toolbar: one click opens the
 * widget on any careers page, not just the job sites where it appears by
 * itself (ADR-0030). Hidden once pinned or dismissed.
 */
export function PinTip() {
  const { store } = useServices();
  const [show, setShow] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([isPinned(), store.get([DISMISSED_KEY])]).then(([pinned, stored]) => {
      if (active) setShow(pinned === false && stored[DISMISSED_KEY] !== true);
    });
    return () => {
      active = false;
    };
  }, [store]);

  if (!show) return null;
  return (
    <div
      role="note"
      className="bg-accent-soft text-accent-ink mx-6 mb-2 flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm"
    >
      <Pin className="size-4 shrink-0" />
      <p className="flex-1">
        <b className="font-semibold">Pin Rolestash to save jobs from any site.</b> Click the
        puzzle-piece icon in Chrome’s toolbar, then the pin next to Rolestash.
      </p>
      <IconButton
        size="sm"
        label="Dismiss tip"
        onClick={() => {
          setShow(false);
          void store.set({ [DISMISSED_KEY]: true });
        }}
      >
        <X className="size-4" />
      </IconButton>
    </div>
  );
}
