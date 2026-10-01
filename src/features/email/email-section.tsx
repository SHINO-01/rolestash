import { Copy, ExternalLink, RefreshCw, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Plan } from '@/domain/plan';
import { Button, ButtonLink } from '@/ui/components/button';
import { Chip } from '@/ui/components/chip';
import { useToast } from '@/ui/components/toast';
import { useEmailState } from '@/ui/hooks/email';
import { useServices } from '@/ui/hooks/services';
import { relativeTime } from '@/ui/format';
import { backendErrorMessage } from '@/features/account/plan-copy';
import { GMAIL_FROM, safeHref, SUGGESTED_SENDERS, SUGGESTED_SUBJECT } from './email-copy';

const PROBLEM = {
  offline: 'Couldn’t reach Rolestash. Updates resume when you’re back online.',
  signed_out: 'Sign in again to keep receiving updates.',
  error: 'The last check didn’t finish. It will try again shortly.',
} as const;

/** Automatic status updates from forwarded email (Advanced; ADR-0014), in Account. */
export function EmailSection({ plan }: { plan: Plan }) {
  const { email } = useServices();
  const state = useEmailState();
  const toast = useToast();
  const [address, setAddress] = useState<string>();
  const [busy, setBusy] = useState<'check' | 'rotate' | 'share' | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [verification, setVerification] = useState<{ code?: string; url?: string }>();

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

  // Creates the address on first visit (Advanced only).
  useEffect(() => {
    if (!email || plan !== 'advanced') return;
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

  if (plan !== 'advanced') {
    return (
      <section className="border-line rounded-xl border p-4">
        <Header />
        <p className="text-muted mt-2 text-sm">
          With Advanced, forward your job emails to a private address and your board updates itself:
          applications received, assessments, interviews (with Join and map links), rejections and
          offers. Plain rules, no AI.
        </p>
      </section>
    );
  }

  const check = () =>
    run('check', async () => {
      const result = await email.run();
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

  const confirmUrl = safeHref(verification?.url);
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

      {verification?.code || confirmUrl ? (
        <div className="mt-3 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="font-semibold">Gmail asked to confirm forwarding</p>
          {verification?.code ? (
            <p className="mt-1">
              Confirmation code:{' '}
              <code className="font-semibold tracking-wider">{verification.code}</code>
            </p>
          ) : null}
          <p className="text-muted mt-1 text-[13px]">
            Enter the code in Gmail’s forwarding settings
            {confirmUrl ? ', or confirm with Google directly' : ''}.
          </p>
          {confirmUrl ? (
            <ButtonLink
              className="mt-2"
              href={confirmUrl}
              size="sm"
              icon={<ExternalLink className="size-3.5" />}
            >
              Confirm with Google
            </ButtonLink>
          ) : null}
        </div>
      ) : null}

      {state?.problem ? (
        <p className="mt-3 text-sm text-amber-800 dark:text-amber-300">{PROBLEM[state.problem]}</p>
      ) : null}

      <div className="mt-3 flex flex-col gap-2">
        <Guide title="Set up in Gmail">
          <li>
            Gmail → <b>Settings</b> → <b>See all settings</b> → <b>Forwarding and POP/IMAP</b> →{' '}
            <b>Add a forwarding address</b>, and paste your address.
          </li>
          <li>
            Gmail sends a confirmation. Its code appears here within a few minutes (press{' '}
            <b>Check now</b>). Enter it in Gmail. You don’t need to turn on forwarding of all mail.
          </li>
          <li>
            Create a filter (<b>Filters and blocked addresses</b> → <b>Create a new filter</b>) with{' '}
            <b>From</b>:
            <Copyable text={GMAIL_FROM} />
            Choose <b>Forward it to</b> your address. Add a second filter with <b>Subject</b>:
            <Copyable text={SUGGESTED_SUBJECT} />
          </li>
          <li>Filters only forward new mail. To try it, forward one job email by hand.</li>
        </Guide>
        <Guide title="Set up in Outlook">
          <li>
            Outlook → <b>Settings</b> → <b>Mail</b> → <b>Rules</b> → <b>Add new rule</b>.
          </li>
          <li>
            Condition <b>From</b> contains any of: <Copyable text={SUGGESTED_SENDERS.join('; ')} />
            Add a second rule with <b>Subject includes</b>: application, interview, assessment,
            offer.
          </li>
          <li>
            Action <b>Forward to</b> your address. Some work accounts block forwarding outside the
            organisation; ask your IT team, or forward by hand.
          </li>
        </Guide>
      </div>

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
            When you accept or correct an update, share what it taught us: a one-way fingerprint of
            the email’s template and which company a sender domain belongs to. Never the email, its
            subject, or which jobs you applied for. Turning this off withdraws what you shared.
          </span>
        </span>
      </label>
      <p className="text-subtle mt-3 text-xs">
        Results are deleted from our server once your board has them, and after 90 days at most. To
        stop, delete your mail filter or get a new address.
      </p>
    </section>
  );
}

function Header({ status }: { status?: string | undefined }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-sm font-semibold">
        Automatic status updates <Chip tone="accent">Advanced</Chip>
      </span>
      {status ? <span className="text-muted text-xs">{status}</span> : null}
    </div>
  );
}

function Guide({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="border-line rounded-lg border px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium">{title}</summary>
      <ol className="text-muted mt-2 list-decimal space-y-2 pl-5 text-[13px]">{children}</ol>
    </details>
  );
}

function Copyable({ text }: { text: string }) {
  const toast = useToast();
  return (
    <span className="my-1.5 flex items-start gap-2">
      <code className="bg-surface-2 min-w-0 flex-1 rounded px-2 py-1 text-xs break-all">
        {text}
      </code>
      <Button
        size="sm"
        variant="ghost"
        aria-label="Copy"
        icon={<Copy className="size-3.5" />}
        onClick={() =>
          void navigator.clipboard
            .writeText(text)
            .then(() => toast({ message: 'Copied', tone: 'success' }))
        }
      />
    </span>
  );
}
