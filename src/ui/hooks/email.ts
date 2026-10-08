import { useEffect, useRef, useState } from 'react';
import type { Plan } from '@/domain/plan';
import type { EmailRun, EmailUpdateState } from '@/services/email-update-service';
import { EMAIL_STATE_KEY } from '@/storage/keys';
import { useServices } from './services';

/** How often an open board checks for new email updates. */
const POLL_MS = 5 * 60_000;
/**
 * With a connected mailbox: often enough that an email shows up on the card
 * about a minute after it arrives. One Gmail search per check, on this
 * device; push (Pub/Sub) would need a server, so it's not used (ADR-0032).
 */
const MAILBOX_MS = 60_000;
/** A focus and a visibility change together are one check, not two. */
const MIN_GAP_MS = 10_000;

/**
 * Whether an open board is due another email check: every minute with a
 * connected mailbox, in view or on another tab (Chrome lets a hidden tab's
 * timer run about once a minute), else every five.
 */
export function emailCheckDue(sinceLastMs: number, mailboxConnected: boolean): boolean {
  return sinceLastMs >= (mailboxConnected ? MAILBOX_MS : POLL_MS);
}

/**
 * Applies email updates (Pro; ADR-0014) while a board is open: when it
 * opens, when it comes back into view, and every few minutes (every minute
 * with a connected mailbox, with a notification when it's not in view). The background worker
 * covers the rest of the time. `onRun` hears about runs that changed something.
 */
export function useAutoEmailUpdates(plan: Plan | undefined, onRun?: (run: EmailRun) => void): void {
  const { email, mailbox, ready } = useServices();
  const callback = useRef(onRun);
  useEffect(() => {
    callback.current = onRun;
  }, [onRun]);

  useEffect(() => {
    if (!email || plan !== 'pro') return;
    let last = 0;
    const run = () => {
      if (Date.now() - last < MIN_GAP_MS) return;
      last = Date.now();
      // In view, the board's toast says what changed; elsewhere, a notification.
      void email
        .run({ notify: document.visibilityState !== 'visible' })
        .then((result) => {
          if (result.applied || result.suggested || result.unsorted) callback.current?.(result);
        })
        .catch(() => undefined);
    };
    const tick = async () => {
      const connected = (await mailbox?.state()) !== undefined;
      if (emailCheckDue(Date.now() - last, connected)) run();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };
    void ready.then(run);
    const timer = setInterval(() => void tick(), 15_000);
    window.addEventListener('focus', run);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', run);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [email, mailbox, plan, ready]);
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
