import { useEffect, useState } from 'react';
import type { AccountService, AccountState } from '@/services/account-service';
import { useServices } from './services';

/**
 * Live account state for the UI. `account` is undefined in builds without a
 * backend, so callers render nothing account-related. Refreshes a stale
 * entitlement when mounted and whenever the window regains focus (e.g. after
 * paying in the checkout tab).
 */
export function useAccount(): { account?: AccountService; state?: AccountState } {
  const { account, ready } = useServices();
  const [state, setState] = useState<AccountState>();

  useEffect(() => {
    if (!account) return;
    let active = true;
    const load = () =>
      void account.state().then((s) => {
        if (active) setState(s);
      });
    void ready.then(load);
    const unsubscribe = account.subscribe(load);
    const refresh = () => void account.refreshIfStale();
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener('focus', refresh);
    };
  }, [account, ready]);

  return account ? { account, ...(state ? { state } : {}) } : {};
}
