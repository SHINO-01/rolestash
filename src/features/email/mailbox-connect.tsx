import { Mail, RefreshCw, Unplug } from 'lucide-react';
import { useState } from 'react';
import type { MailProvider } from '@/services/mail/types';
import { Button } from '@/ui/components/button';
import { useToast } from '@/ui/components/toast';
import { relativeTime } from '@/ui/format';
import { useMailboxState } from '@/ui/hooks/mailbox';
import { useServices } from '@/ui/hooks/services';

const NAMES: Record<MailProvider, string> = { gmail: 'Gmail', outlook: 'Outlook' };

/**
 * "Connect Gmail" / "Connect Outlook" (ADR-0032): read-only access, read on
 * this device, so the board updates itself from job emails with nothing to
 * forward. Shown above the forwarding address, which stays as the option
 * that gives Rolestash no access to the inbox.
 */
export function MailboxConnect() {
  const { mailbox, email } = useServices();
  const state = useMailboxState();
  const toast = useToast();
  const [busy, setBusy] = useState<MailProvider | 'check' | 'disconnect' | null>(null);
  if (!mailbox || state === undefined) return null;
  const providers = mailbox.providers();

  async function run(key: NonNullable<typeof busy>, task: () => Promise<void>) {
    setBusy(key);
    try {
      await task();
    } catch (e) {
      const cancelled = e instanceof Error && /cancel|closed|did not approve/i.test(e.message);
      toast({
        tone: 'error',
        message:
          key === 'check'
            ? 'Couldn’t check your email just now. Try again in a moment.'
            : cancelled
              ? 'Connection cancelled.'
              : 'Couldn’t connect the mailbox. Allow Rolestash to read your email, then try again.',
      });
    } finally {
      setBusy(null);
    }
  }

  const check = async (announce: boolean) => {
    const result = await email?.run();
    if (!announce || !result) return;
    if (result.skipped) {
      // Nothing was checked: never say "up to date" then.
      toast({
        tone: 'info',
        message:
          result.skipped === 'busy'
            ? 'Already checking your email. Try again in a moment.'
            : 'Email updates are part of Pro.',
      });
      return;
    }
    const problem = (await mailbox.state())?.problem;
    if (problem) {
      toast({
        tone: 'error',
        message:
          problem === 'reconnect'
            ? 'Rolestash can’t read your inbox any more. Connect it again.'
            : 'Couldn’t reach your inbox. Check your connection, then try again.',
      });
      return;
    }
    const total = result.applied + result.suggested + result.unsorted;
    toast({
      tone: 'success',
      message: total
        ? `${String(result.applied)} updated, ${String(result.suggested)} to review, ${String(result.unsorted)} to sort`
        : 'Your board is up to date',
    });
  };

  const connect = (provider: MailProvider) =>
    void run(provider, async () => {
      const connected = await mailbox.connect(provider);
      toast({ tone: 'success', message: `${NAMES[provider]} connected: ${connected.address}` });
      await check(true);
    });

  if (!state)
    return (
      <div className="bg-accent-soft/60 border-accent/20 mt-3 rounded-xl border p-3.5">
        <p className="text-sm font-medium">Connect your inbox</p>
        <p className="text-muted mt-1 text-[13px]">
          Read-only. Rolestash looks only at job emails, on this computer, and updates your board
          when Chrome opens and every few minutes after. Nothing from your inbox is sent to us.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {providers.map((provider) => (
            <Button
              key={provider}
              size="sm"
              variant={provider === providers[0] ? 'primary' : 'secondary'}
              icon={<Mail className="size-3.5" />}
              loading={busy === provider}
              disabled={busy !== null}
              onClick={() => connect(provider)}
            >
              Connect {NAMES[provider]}
            </Button>
          ))}
        </div>
      </div>
    );

  return (
    <div
      className="border-line mt-3 rounded-xl border p-3.5"
      role="group"
      aria-label="Connected mailbox"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm">
          <span className="font-medium">{NAMES[state.provider]} connected</span>
          <span className="text-muted"> · {state.address}</span>
        </p>
        {state.lastCheckedAt ? (
          <span className="text-muted shrink-0 text-xs">
            Checked {relativeTime(state.lastCheckedAt)}
          </span>
        ) : null}
      </div>
      {state.problem === 'reconnect' ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="text-sm text-amber-800 dark:text-amber-300">
            {NAMES[state.provider]} needs you to connect again.
          </p>
          <Button
            size="sm"
            variant="primary"
            loading={busy === state.provider}
            disabled={busy !== null}
            onClick={() => connect(state.provider)}
          >
            Reconnect
          </Button>
        </div>
      ) : state.problem === 'offline' ? (
        <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">
          Couldn’t reach {NAMES[state.provider]}. It will try again shortly.
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          icon={<RefreshCw className="size-3.5" />}
          loading={busy === 'check'}
          disabled={busy !== null}
          onClick={() => void run('check', () => check(true))}
        >
          Check now
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Unplug className="size-3.5" />}
          loading={busy === 'disconnect'}
          disabled={busy !== null}
          onClick={() =>
            void run('disconnect', async () => {
              await mailbox.disconnect();
              toast({ tone: 'success', message: `${NAMES[state.provider]} disconnected` });
            })
          }
        >
          Disconnect
        </Button>
      </div>
    </div>
  );
}
