import { useEffect, useRef, useState } from 'react';
import type { Plan } from '@/domain/plan';
import type { EmailRun, EmailUpdateState } from '@/services/email-update-service';
import { EMAIL_STATE_KEY } from '@/storage/keys';
import { useServices } from './services';

/** How often an open board checks for new email updates. */
const POLL_MS = 5 * 60_000;

/**
 * Applies email updates (Pro; ADR-0014) while a board is open: when it
 * opens, when it regains focus, and every few minutes. The background worker
 * covers the rest of the time. `onRun` hears about runs that changed something.
 */
export function useAutoEmailUpdates(plan: Plan | undefined, onRun?: (run: EmailRun) => void): void {
  const { email, ready } = useServices();
  const callback = useRef(onRun);
  useEffect(() => {
    callback.current = onRun;
  }, [onRun]);

  useEffect(() => {
    if (!email || plan !== 'pro') return;
    const run = () =>
      void email
        .run()
        .then((result) => {
          if (result.applied || result.suggested || result.unsorted) callback.current?.(result);
        })
        .catch(() => undefined);
    void ready.then(run);
    const timer = setInterval(run, POLL_MS);
    window.addEventListener('focus', run);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', run);
    };
  }, [email, plan, ready]);
}

/** Live email-updates state: unsorted updates, the address, the Gmail code. */
export function useEmailState(): EmailUpdateState | undefined {
  const { email, store } = useServices();
  const [state, setState] = useState<EmailUpdateState>();
  useEffect(() => {
    if (!email) return;
    let active = true;
    const load = () =>
      void email.state().then((s) => {
        if (active) setState(s);
      });
    load();
    const unsubscribe = store.subscribe((changes) => {
      if (EMAIL_STATE_KEY in changes) load();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [email, store]);
  return state;
}
