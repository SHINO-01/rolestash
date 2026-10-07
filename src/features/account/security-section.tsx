import { KeyRound, LogOut } from 'lucide-react';
import { useState } from 'react';
import type { AccountService, AccountState } from '@/services/account-service';
import { Button } from '@/ui/components/button';
import { useToast } from '@/ui/components/toast';
import { NewPasswordForm } from './new-password-form';
import { backendErrorMessage } from './plan-copy';

/**
 * Account → Security (ADR-0036): an optional password, and signing out on
 * every device. Codes and Google keep working with or without a password.
 */
export function SecuritySection({
  account,
  state,
  beforeSignOutEverywhere,
}: {
  account: AccountService;
  state: AccountState;
  /** Clears what this browser keeps before the session ends (the web board's copy). */
  beforeSignOutEverywhere?: () => Promise<void>;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<'password' | 'everywhere' | null>(null);

  async function run(kind: 'password' | 'everywhere', task: () => Promise<void>) {
    setBusy(kind);
    try {
      await task();
    } catch (e) {
      toast({ message: backendErrorMessage(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="border-line rounded-xl border p-4">
      <span className="text-sm font-semibold">Security</span>
      {editing ? (
        <div className="mt-3">
          <NewPasswordForm
            email={state.email}
            submitLabel={state.hasPassword ? 'Change password' : 'Add password'}
            busy={busy === 'password'}
            onCancel={() => setEditing(false)}
            onSubmit={(password) =>
              void run('password', async () => {
                await account.setPassword(password);
                setEditing(false);
                toast({
                  message: state.hasPassword ? 'Password changed' : 'Password added',
                  tone: 'success',
                });
              })
            }
          />
        </div>
      ) : (
        <>
          <p className="text-muted mt-2 text-sm">
            {state.hasPassword
              ? 'You can sign in with your password, an emailed code, or Google.'
              : 'Optional: add a password to sign in without waiting for a code. Codes and Google keep working.'}
          </p>
          <Button
            className="mt-3"
            size="sm"
            icon={<KeyRound className="size-4" />}
            disabled={busy !== null}
            onClick={() => setEditing(true)}
          >
            {state.hasPassword ? 'Change password' : 'Add a password'}
          </Button>
        </>
      )}

      <div className="border-line mt-4 border-t pt-3">
        {confirming ? (
          <div className="flex flex-col gap-2">
            <p className="text-muted text-sm">
              Sign out on every device, this one included? Your boards stay on each device; you sign
              in again where you want to keep syncing.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="danger"
                loading={busy === 'everywhere'}
                onClick={() =>
                  void run('everywhere', async () => {
                    await beforeSignOutEverywhere?.();
                    await account.signOutEverywhere();
                  })
                }
              >
                Sign out everywhere
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            icon={<LogOut className="size-4" />}
            disabled={busy !== null}
            onClick={() => setConfirming(true)}
          >
            Sign out everywhere
          </Button>
        )}
      </div>
    </section>
  );
}
