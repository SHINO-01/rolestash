import { useState } from 'react';
import { DisplayNameSchema } from '@/domain/account-profile';
import type { AccountService } from '@/services/account-service';
import { Button } from '@/ui/components/button';
import { Field, Input } from '@/ui/components/field';
import { useToast } from '@/ui/components/toast';
import { backendErrorMessage } from './plan-copy';

/**
 * Asked once after signing in with an email code (ADR-0024): an email address
 * says nothing about the person's name. Google sign-ins never see this.
 * "Skip" stops asking on this device; the name can be added in Account later.
 */
export function NameQuestion({ account }: { account: AccountService }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = DisplayNameSchema.safeParse(name).success;

  async function save() {
    if (!valid) return;
    setBusy(true);
    try {
      await account.saveName(name.trim());
      toast({ message: 'Name saved', tone: 'success' });
    } catch (e) {
      toast({ message: backendErrorMessage(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="border-accent/30 bg-accent-soft/50 flex flex-col gap-3 rounded-xl border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div>
        <p className="text-sm font-semibold">What’s your name?</p>
        <p className="text-muted mt-0.5 text-[13px]">
          Your full name, as it should appear on receipts. We’ll greet you by your first name.
        </p>
      </div>
      <Field label="Full name">
        {(id) => (
          <Input
            id={id}
            autoComplete="name"
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sam Taylor"
          />
        )}
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => void account.skipName()}>
          Skip
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={!valid || busy}>
          Save name
        </Button>
      </div>
    </form>
  );
}
