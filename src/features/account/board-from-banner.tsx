import { Users } from 'lucide-react';
import { useState } from 'react';
import type { AccountService, AccountState } from '@/services/account-service';
import { Button } from '@/ui/components/button';
import { useToast } from '@/ui/components/toast';

/**
 * Someone else's jobs are on this browser's board (they were signed in here
 * before): keep them in this account, or remove them from this browser.
 * Until then sync stays off, so they never reach this account unasked.
 */
export function BoardFromBanner({
  account,
  state,
}: {
  account: AccountService;
  state: AccountState;
}) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const from = state.boardFrom;
  if (!from) return null;
  const jobs = `${String(from.jobs)} ${from.jobs === 1 ? 'job' : 'jobs'}`;

  const act = async (keep: boolean) => {
    setBusy(true);
    try {
      if (keep) await account.keepBoard();
      else await account.removeBoard();
      toast({
        tone: 'success',
        message: keep ? 'Those jobs are now on your board' : 'Removed from this browser',
      });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div
      role="alert"
      className="mx-6 mb-2 flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:bg-amber-500/15 dark:text-amber-200"
    >
      <Users aria-hidden className="size-4 shrink-0" />
      <p className="min-w-60 flex-1">
        {confirming ? (
          <>
            <b className="font-semibold">Remove {jobs} from this browser?</b> If {from.email} synced
            them, they stay in that account.
          </>
        ) : (
          <>
            <b className="font-semibold">
              This board has {jobs} from another account ({from.email}).
            </b>{' '}
            They aren’t in your account, and sync stays off until you choose.
          </>
        )}
      </p>
      {confirming ? (
        <>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="danger" loading={busy} onClick={() => void act(false)}>
            Remove
          </Button>
        </>
      ) : (
        <>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirming(true)}>
            Remove from this browser
          </Button>
          <Button size="sm" variant="primary" loading={busy} onClick={() => void act(true)}>
            Keep them in my account
          </Button>
        </>
      )}
    </div>
  );
}
