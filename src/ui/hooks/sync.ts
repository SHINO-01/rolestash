import { useEffect, useState } from 'react';
import type { SyncState } from '@/services/sync-service';
import { SYNC_STATE_KEY } from '@/storage/keys';
import { useServices } from './services';

/** Quiet time after a local change before syncing it. */
const DEBOUNCE_MS = 3000;

/**
 * Keeps this board in step (ADR-0016): syncs when the board opens or regains
 * focus, and shortly after local changes. Problems land in the sync state,
 * which the account dialog shows.
 */
export function useAutoSync(): void {
  const { sync, store, ready } = useServices();
  useEffect(() => {
    if (!sync) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => void sync.sync().catch(() => undefined);
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(run, DEBOUNCE_MS);
    };
    void ready.then(run);
    window.addEventListener('focus', run);
    const unsubscribe = store.subscribe((changes) => {
      if (Object.keys(changes).some((k) => k.startsWith('job:') || k === 'settings')) later();
    });
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', run);
      unsubscribe();
    };
  }, [sync, store, ready]);
}

/** Live sync state for the account dialog. */
export function useSyncState(): SyncState | undefined {
  const { sync, store } = useServices();
  const [state, setState] = useState<SyncState>();
  useEffect(() => {
    if (!sync) return;
    const load = () => void sync.state().then(setState);
    load();
    return store.subscribe((changes) => {
      if (SYNC_STATE_KEY in changes) load();
    });
  }, [sync, store]);
  return state;
}
