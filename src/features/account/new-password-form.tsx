import { useEffect, useState } from 'react';
import { checkPassword, PASSWORD_MAX, type PasswordVerdict } from '@/domain/password';
import { Button } from '@/ui/components/button';
import { Field, Input } from '@/ui/components/field';

/**
 * A new password, typed twice, checked on the device as it's typed
 * (ADR-0036): at least 12 characters, not guessable, not from the email.
 */
export function NewPasswordForm({
  email,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  email: string | undefined;
  submitLabel: string;
  busy: boolean;
  onSubmit: (password: string) => void;
  onCancel?: () => void;
}) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  // The verdict for the password it was worked out for; stale ones don't show.
  const [checked, setChecked] = useState<{ password: string; verdict: PasswordVerdict }>();
  const verdict = password && checked?.password === password ? checked.verdict : undefined;

  // Checks a moment after typing stops; the word list loads on first use.
  useEffect(() => {
    if (!password) return;
    let live = true;
    const timer = setTimeout(() => {
      void checkPassword(password, email).then((v) => {
        if (live) setChecked({ password, verdict: v });
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [password, email]);

  const mismatch = again.length > 0 && again !== password;
  const ready = verdict?.ok === true && again === password;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSubmit(password);
      }}
    >
      {/* Lets password managers save the password against the right account. */}
      {email ? <input type="email" autoComplete="username" value={email} readOnly hidden /> : null}
      <Field
        label="New password"
        hint={
          verdict === undefined ? (
            'At least 12 characters. A few unrelated words are easy to remember and hard to guess.'
          ) : verdict.ok ? (
            <span className="text-emerald-700 dark:text-emerald-400">Strong enough.</span>
          ) : (
            <span className="text-amber-800 dark:text-amber-300">{verdict.message}</span>
          )
        }
      >
        {(id) => (
          <Input
            id={id}
            type="password"
            autoComplete="new-password"
            maxLength={PASSWORD_MAX}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </Field>
      <Field
        label="Type it again"
        hint={
          mismatch ? (
            <span className="text-amber-800 dark:text-amber-300">These don’t match yet.</span>
          ) : undefined
        }
      >
        {(id) => (
          <Input
            id={id}
            type="password"
            autoComplete="new-password"
            maxLength={PASSWORD_MAX}
            value={again}
            warn={mismatch}
            onChange={(e) => setAgain(e.target.value)}
          />
        )}
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={busy} disabled={!ready || busy}>
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
