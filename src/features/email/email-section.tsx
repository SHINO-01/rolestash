import { Copy, RefreshCw, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { Plan } from '@/domain/plan';
import { Button } from '@/ui/components/button';
import { Chip } from '@/ui/components/chip';
import { useToast } from '@/ui/components/toast';
import { useEmailState } from '@/ui/hooks/email';
import { useServices } from '@/ui/hooks/services';
import { relativeTime } from '@/ui/format';
import { backendErrorMessage } from '@/features/account/plan-copy';
import { EmailSetupGuide } from './email-setup';
import { useMailboxState } from '@/ui/hooks/mailbox';
import { MailboxConnect } from './mailbox-connect';

const PROBLEM = {
  offline: 'Couldn’t reach Rolestash. Updates resume when you’re back online.',
  signed_out: 'Sign in again to keep receiving updates.',
  error: 'The last check didn’t finish. It will try again shortly.',
} as const;

/** Automatic status updates from forwarded email (Pro; ADR-0014), in Account. */
export function EmailSection({ plan, trial = false }: { plan: Plan; trial?: boolean }) {
  const services = useServices();
  const { email } = services;
  const state = useEmailState();
  const toast = useToast();
  const [address, setAddress] = useState<string>();
  const [busy, setBusy] = useState<'check' | 'rotate' | 'share' | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [verification, setVerification] = useState<{ code?: string; url?: string }>();
  const mailboxState = useMailboxState();

  const run = useCallback(
    async (key: 'check' | 'rotate' | 'share', task: () => Promise<void>) => {
      setBusy(key);
      try {
        await task();
      } catch (e) {
        toast({ message: backendErrorMessage(e), tone: 'error' });
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );

  // Creates the address on first visit (Pro only).
  useEffect(() => {
    if (!email || plan !== 'pro') return;
    let active = true;
    email
      .address()
      .then((info) => {
        if (active && info.ok) setAddress(info.address);
      })
      .catch((e: unknown) => {
        if (active) toast({ message: backendErrorMessage(e), tone: 'error' });
      });
    return () => {
      active = false;
    };
  }, [email, plan, toast]);

  useEffect(() => {
    if (!email) return;
    void email.verification().then(setVerification);
  }, [email, state?.verification]);

  if (!email) return null;

  if (plan !== 'pro') {
    return (
      <section className="border-line rounded-xl border p-4">
        <Header pitch />
        <p className="text-muted mt-2 text-sm">
          With Pro, {mailboxPitch(services.mailbox?.providers() ?? [])} and your board updates
          itself: applications received, assessments, interviews (with Join and map links),
          rejections and offers. Plain rules, no AI.
        </p>
      </section>
    );
  }

  const check = () =>
    run('check', async () => {
      const result = await email.run();
      if (result.skipped) {
        // Nothing was checked: never say "no new updates" then.
        toast({
          tone: 'info',
          message:
            result.skipped === 'busy'
              ? 'Already checking your email. Try again in a moment.'
              : 'Email updates are part of Pro.',
        });
        return;
      }
      toast({
        tone: 'success',
        message:
          result.applied + result.suggested + result.unsorted > 0
            ? `${String(result.applied)} updated, ${String(result.suggested)} suggested, ${String(result.unsorted)} to sort`
            : 'No new updates',
      });
    });

  const rotate = () =>
    run('rotate', async () => {
      const info = await email.address(true);
      if (info.ok) setAddress(info.address);
      setConfirmRotate(false);
      toast({ message: 'New address ready. Update your mail filter to use it.', tone: 'success' });
    });

  const share = (on: boolean) =>
    run('share', async () => {
      await email.setSharing(on);
    });

  const copy = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    toast({ message: 'Address copied', tone: 'success' });
  };

  // The forwarding address: the way in that gives Rolestash no access to the inbox.
  const forwarding = (
    <>
      <p className="text-muted mt-2 text-sm">
        Forward job emails to this private address and your board updates itself. We keep only what
        we found (like “interview, Thu 10am, Zoom link”), never the email.
      </p>

      <div className="bg-surface-2 mt-3 flex items-center gap-2 rounded-lg px-3 py-2">
        <code className="min-w-0 flex-1 truncate text-[13px]" aria-label="Your forwarding address">
          {address ?? '…'}
        </code>
        <Button
          size="sm"
          icon={<Copy className="size-3.5" />}
          disabled={!address}
          onClick={() => void copy()}
        >
          Copy
        </Button>
      </div>

      {state?.problem ? (
        <p className="mt-3 text-sm text-amber-800 dark:text-amber-300">{PROBLEM[state.problem]}</p>
      ) : null}

      {state?.lastEmailAt ? (
        <details className="border-line mt-3 rounded-lg border px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium">Set-up steps</summary>
          <EmailSetupGuide address={address} state={state} verification={verification} />
        </details>
      ) : (
        <EmailSetupGuide address={address} state={state} verification={verification} />
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          icon={<RefreshCw className="size-3.5" />}
          loading={busy === 'check'}
          disabled={busy !== null}
          onClick={() => void check()}
        >
          Check now
        </Button>
        {confirmRotate ? (
          <>
            <Button
              size="sm"
              variant="danger"
              loading={busy === 'rotate'}
              disabled={busy !== null}
              onClick={() => void rotate()}
            >
              Replace address
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmRotate(false)}>
              Keep it
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            icon={<RotateCcw className="size-3.5" />}
            disabled={busy !== null}
            onClick={() => setConfirmRotate(true)}
          >
            Get a new address
          </Button>
        )}
      </div>
      {confirmRotate ? (
        <p className="text-muted mt-2 text-[13px]">
          Mail to the current address stops arriving at once. Update your mail filter afterwards.
        </p>
      ) : null}
    </>
  );

  return (
    <section className="border-line rounded-xl border p-4">
      <Header
        status={
          state?.lastRunAt
            ? `Checked ${relativeTime(state.lastRunAt)}`
            : address
              ? undefined
              : 'Loading…'
        }
      />
      <MailboxConnect />
      {mailboxState ? (
        <details className="border-line mt-3 rounded-lg border px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium">Forwarding address (optional)</summary>
          {forwarding}
        </details>
      ) : (
        <>
          {mailboxState === null && services.mailbox ? (
            <p className="text-muted mt-4 text-[13px] font-medium">
              Or forward job emails instead, with no access to your inbox:
            </p>
          ) : null}
          {forwarding}
        </>
      )}
      {trial ? (
        // Trial accounts don't vote (only subscribers' votes count), so nothing is shared.
        <p className="text-muted mt-4 text-[13px]">
          During your free trial, nothing you accept or correct is shared. “Help improve automatic
          updates” becomes available once you subscribe.
        </p>
      ) : (
        <label className="mt-4 flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            className="accent-accent mt-0.5 size-4"
            checked={state?.shareLearning !== false}
            disabled={busy !== null}
            onChange={(e) => void share(e.target.checked)}
          />
          <span>
            <span className="font-medium">Help improve automatic updates</span>
            <span className="text-muted block text-[13px]">
              When you accept or correct an update, share what it taught us: a one-way fingerprint
              of the email’s template and which company a sender domain belongs to. Never the email,
              its subject, or which jobs you applied for. Turning this off withdraws what you
              shared.
            </span>
          </span>
        </label>
      )}
      <p className="text-subtle mt-3 text-xs">
        Results are deleted from our server once your board has them, and after 90 days at most. To
        stop, delete your mail filter or get a new address.
      </p>
    </section>
  );
}

/** The plan chip is a pitch, so only people without Pro see it. */
function Header({ status, pitch = false }: { status?: string | undefined; pitch?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-sm font-semibold">
        Automatic status updates {pitch ? <Chip tone="accent">Pro</Chip> : null}
      </span>
      {status ? <span className="text-muted text-xs">{status}</span> : null}
    </div>
  );
}

/** What Pro offers for email here: only the mailboxes this build can connect, and forwarding. */
function mailboxPitch(providers: readonly string[]): string {
  const names = providers.map((p) => (p === 'gmail' ? 'Gmail' : 'Outlook'));
  return names.length
    ? `connect ${names.join(' or ')} (or forward your job emails)`
    : 'forward your job emails';
}
