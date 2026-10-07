import { useEffect, useState } from 'react';
import type { MailboxState } from '@/services/mailbox-service';
import { MAILBOX_STATE_KEY } from '@/storage/keys';
import { useServices } from './services';

/**
 * The connected mailbox, live from storage. `null`: none connected;
 * `undefined`: not known yet (or this build can't connect one).
 */
export function useMailboxState(): MailboxState | undefined | null {
  const { mailbox, store } = useServices();
  const [state, setState] = useState<MailboxState | null>();
  useEffect(() => {
    if (!mailbox) return;
    let active = true;
    const load = () =>
      void mailbox.state().then((s) => {
        if (active) setState(s ?? null);
      });
    load();
    const unsubscribe = store.subscribe((changes) => {
      if (MAILBOX_STATE_KEY in changes) load();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [mailbox, store]);
  return state;
}
