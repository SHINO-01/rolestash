import { useState } from 'react';
import type { AccountService } from '@/services/account-service';
import { NewPasswordForm } from '@/features/account/new-password-form';
import { backendErrorMessage } from '@/features/account/plan-copy';
import { Button } from '@/ui/components/button';
import type { Recovery } from './recovery';

/** Choose a new password from a reset link; every session is signed out after. */
export function PasswordReset({
  account,
  recovery,
  onDone,
}: {
  account: AccountService;
  recovery: Recovery;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);

  if ('error' in recovery || done)
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">
          {done ? 'Password changed' : 'Reset link not valid'}
        </h1>
        <p className="text-muted text-sm">
          {done
            ? 'You’re signed out everywhere, so anyone who knew the old password is out too. Sign in with your new password.'
            : 'error' in recovery
              ? recovery.error
              : ''}
        </p>
        <Button variant="primary" onClick={onDone}>
          Continue to sign in
        </Button>
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Choose a new password</h1>
        <p className="text-muted mt-1 text-sm">
          {recovery.email ? (
            <>
              For <strong className="text-ink">{recovery.email}</strong>.{' '}
            </>
          ) : null}
          After this, every device is signed out.
        </p>
      </div>
      <NewPasswordForm
        email={recovery.email}
        submitLabel="Save new password"
        busy={busy}
        onSubmit={(password) => {
          setBusy(true);
          setError(undefined);
          account
            .completePasswordReset(recovery.token, password)
            .then(() => setDone(true))
            .catch((e: unknown) => setError(backendErrorMessage(e)))
            .finally(() => setBusy(false));
        }}
      />
      {error ? (
        <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
