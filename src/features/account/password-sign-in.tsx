import { useState } from 'react';
import type { AccountService } from '@/services/account-service';
import { Button } from '@/ui/components/button';
import { Field, Input } from '@/ui/components/field';
import { backendErrorMessage } from './plan-copy';

/**
 * Sign in with a password, for accounts that added one (ADR-0036), and
 * "Forgot password?", which emails a reset link to the web board. The same
 * answer whether or not the email has an account.
 */
export function PasswordSignIn({
  account,
  before,
  after,
  onUseCode,
}: {
  account: AccountService;
  /** Runs first (the sharing choice made on the sign-in screen). */
  before?: () => Promise<void>;
  /** Runs after a successful sign-in. */
  after?: () => void;
  onUseCode: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'in' | 'reset' | null>(null);
  const [error, setError] = useState<string>();
  const [resetSent, setResetSent] = useState(false);

  async function run(kind: 'in' | 'reset', task: () => Promise<void>) {
    setBusy(kind);
    setError(undefined);
    try {
      await task();
    } catch (e) {
      setError(backendErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run('in', async () => {
          await before?.();
          await account.signInWithPassword(email, password);
          after?.();
        });
      }}
    >
      <Field label="Email">
        {(id) => (
          <Input
            id={id}
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        )}
      </Field>
      <Field label="Password">
        {(id) => (
          <Input
            id={id}
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </Field>
      <Button
        type="submit"
        variant="primary"
        loading={busy === 'in'}
        disabled={busy !== null || !email.includes('@') || !password}
      >
        Sign in
      </Button>
      {resetSent ? (
        <p role="status" className="text-muted text-sm">
          If there’s an account for <strong className="text-ink">{email}</strong>, a link to choose
          a new password is on its way. It opens the web board and works for 10 minutes.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      ) : null}
      <div className="flex justify-between">
        <Button variant="ghost" size="sm" disabled={busy !== null} onClick={onUseCode}>
          Use a code instead
        </Button>
        <Button
          variant="ghost"
          size="sm"
          loading={busy === 'reset'}
          disabled={busy !== null || !email.includes('@')}
          title={email.includes('@') ? undefined : 'Enter your email first'}
          onClick={() =>
            void run('reset', async () => {
              await account.requestPasswordReset(email);
              setResetSent(true);
            })
          }
        >
          Forgot password?
        </Button>
      </div>
    </form>
  );
}
