import { ShieldCheck, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { AccountService } from '@/services/account-service';
import type { Factor } from '@/services/backend/supabase-client';
import { Button, IconButton } from '@/ui/components/button';
import { Field, Input } from '@/ui/components/field';
import { QrCode } from '@/ui/components/qr-code';
import { useToast } from '@/ui/components/toast';
import { formatDate } from '@/ui/format';
import { backendErrorMessage } from './plan-copy';

/**
 * Two-step sign-in in Account → Security (ADR-0036): add an authenticator app
 * (scan a QR code, drawn on the device, then enter its first code), add a
 * backup one, or remove them. Supabase Auth keeps the secret; any TOTP app
 * works (Google or Microsoft Authenticator, 1Password, Authy…).
 */
export function TwoStepPanel({ account, on }: { account: AccountService; on: boolean }) {
  const toast = useToast();
  const [apps, setApps] = useState<Factor[]>();
  const [adding, setAdding] = useState<{ id: string; uri: string; secret: string }>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string>();

  const load = useCallback(async () => {
    setApps(await account.authenticators().catch(() => []));
  }, [account]);
  useEffect(() => {
    let live = true;
    void account
      .authenticators()
      .catch(() => [])
      .then((list) => {
        if (live) setApps(list);
      });
    return () => {
      live = false;
    };
  }, [account, on]);

  async function run(key: string, task: () => Promise<void>) {
    setBusy(key);
    try {
      await task();
    } catch (e) {
      toast({ message: backendErrorMessage(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  if (adding)
    return (
      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run('confirm', async () => {
            await account.confirmAuthenticator(adding.id, code);
            setAdding(undefined);
            setCode('');
            await load();
            toast({ message: 'Two-step sign-in is on', tone: 'success' });
          });
        }}
      >
        <p className="text-muted text-sm">
          1. In your authenticator app, add an account and scan this code. Any app works: Google or
          Microsoft Authenticator, 1Password, Authy.
        </p>
        <div className="flex flex-col items-center gap-2">
          <QrCode
            text={adding.uri}
            label="QR code for your authenticator app"
            className="size-40 rounded-lg"
          />
          <p className="text-subtle text-center text-xs">
            Can’t scan? Type this key instead:
            <br />
            <code className="text-ink font-mono text-sm tracking-wider select-all">
              {adding.secret.replace(/(.{4})/g, '$1 ').trim()}
            </code>
          </p>
        </div>
        <Field label="2. Enter the 6-digit code it shows">
          {(id) => (
            <Input
              id={id}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
            />
          )}
        </Field>
        <div className="flex gap-2">
          <Button
            type="submit"
            variant="primary"
            size="sm"
            loading={busy === 'confirm'}
            disabled={busy !== null || code.replace(/\s/g, '').length !== 6}
          >
            Turn on
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => {
              setAdding(undefined);
              setCode('');
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    );

  const start = () =>
    void run('start', async () => {
      setAdding(await account.startAuthenticator());
    });

  return (
    <div className="mt-3">
      <p className="text-muted flex gap-2 text-sm">
        <ShieldCheck className="text-accent mt-0.5 size-4 shrink-0" />
        {on
          ? 'Two-step sign-in is on: every sign-in also asks for a code from your authenticator app.'
          : 'Two-step sign-in: after your code, password or Google, also enter a code from an authenticator app on your phone. Someone who gets into your email still can’t get in.'}
      </p>
      {on && apps?.length ? (
        <ul aria-label="Authenticator apps" className="divide-line mt-2 divide-y">
          {apps.map((f) => (
            <li key={f.id} className="flex items-center gap-2 py-2 text-sm">
              <span className="flex-1">
                {f.name}
                {f.createdAt ? (
                  <span className="text-subtle block text-xs">Added {formatDate(f.createdAt)}</span>
                ) : null}
              </span>
              {removing === f.id ? (
                <Button
                  size="sm"
                  variant="danger"
                  loading={busy === `rm-${f.id}`}
                  onClick={() =>
                    void run(`rm-${f.id}`, async () => {
                      await account.removeAuthenticator(f.id);
                      setRemoving(undefined);
                      await load();
                      toast({
                        message:
                          apps.length === 1 ? 'Two-step sign-in is off' : `${f.name} removed`,
                        tone: 'success',
                      });
                    })
                  }
                >
                  {apps.length === 1 ? 'Remove and turn off' : 'Remove'}
                </Button>
              ) : (
                <IconButton
                  label={`Remove ${f.name}`}
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => setRemoving(f.id)}
                >
                  <Trash2 className="size-4" />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <Button
        className="mt-2"
        size="sm"
        loading={busy === 'start'}
        disabled={busy !== null}
        onClick={start}
      >
        {on ? 'Add a backup authenticator' : 'Turn on two-step sign-in'}
      </Button>
    </div>
  );
}
