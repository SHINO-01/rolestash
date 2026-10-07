import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { AccountService } from '@/services/account-service';
import { Button } from '@/ui/components/button';
import { Field, Input } from '@/ui/components/field';
import { backendErrorMessage } from './plan-copy';

/** The second step of signing in: the code from the authenticator app (ADR-0036). */
export function SecondStep({ account, after }: { account: AccountService; after?: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function verify() {
    setBusy(true);
    setError(undefined);
    try {
      await account.verifySecondStep(code);
      after?.();
    } catch (e) {
      setError(backendErrorMessage(e));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void verify();
      }}
    >
      <p className="text-muted flex gap-2 text-sm">
        <ShieldCheck className="text-accent mt-0.5 size-4 shrink-0" />
        Two-step sign-in is on. Enter the 6-digit code your authenticator app shows for Rolestash.
      </p>
      <Field label="Authenticator code">
        {(id) => (
          <Input
            id={id}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={7}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
          />
        )}
      </Field>
      <Button
        type="submit"
        variant="primary"
        loading={busy}
        disabled={busy || code.replace(/\s/g, '').length !== 6}
      >
        Sign in
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => void account.cancelSecondStep()}
      >
        Cancel and use another account
      </Button>
      <p className="text-subtle text-xs">
        Lost the phone with your authenticator? Email{' '}
        <a className="underline" href="mailto:support@rolestash.com">
          support@rolestash.com
        </a>{' '}
        from this address and we’ll turn two-step sign-in off after checking it’s you.
      </p>
    </form>
  );
}
