import clsx from 'clsx';
import { Check, Copy, ExternalLink, Loader2, UserPlus } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import type { EmailSetup, EmailUpdateState } from '@/services/email-update-service';
import { Button, ButtonLink } from '@/ui/components/button';
import { useToast } from '@/ui/components/toast';
import { useServices } from '@/ui/hooks/services';
import { relativeTime } from '@/ui/format';
import { GMAIL_QUERY, safeHref, SUGGESTED_SENDERS } from './email-copy';

/**
 * Guided setup for automatic status updates (ADR-0014): pick a mail service,
 * then a few short steps, each with a button that opens the right page and
 * the text to paste. Progress is detected where it can be (Gmail's
 * confirmation code arriving, the first forwarded email) and ticked by the
 * user where it can't.
 */

type Provider = NonNullable<EmailSetup['provider']>;

const PROVIDERS: { id: Provider; label: string; hint: string }[] = [
  { id: 'manual', label: 'I’ll forward emails myself', hint: 'Easiest: no settings to change' },
  { id: 'gmail', label: 'Gmail', hint: 'Forward automatically' },
  { id: 'outlook', label: 'Outlook or Hotmail', hint: 'Forward automatically' },
];

const GMAIL_FORWARDING = 'https://mail.google.com/mail/u/0/#settings/fwdandpop';
const GMAIL_SEARCH = `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(GMAIL_QUERY)}`;
const OUTLOOK_RULES = 'https://outlook.live.com/mail/0/options/mail/rules';
/** While the user waits for Gmail's code, check this often (only while this is open). */
const POLL_MS = 15_000;

export function EmailSetupGuide({
  address,
  state,
  verification,
}: {
  address: string | undefined;
  state: EmailUpdateState | undefined;
  /** Gmail's forwarding confirmation, while it's recent. */
  verification: { code?: string; url?: string } | undefined;
}) {
  const { email } = useServices();
  const setup: EmailSetup = state?.setup ?? { done: [] };
  const provider = setup.provider;
  const done = new Set(setup.done);
  const working = state?.lastEmailAt !== undefined;
  const code = verification?.code;
  const confirmUrl = safeHref(verification?.url);

  const save = (next: EmailSetup) => void email?.setSetup(next);
  const tick = (step: string) => save({ ...setup, done: [...setup.done, step] });

  // Gmail: look for the confirmation code every few seconds until it arrives.
  const waitingForCode = provider === 'gmail' && done.has('forward') && !code && !working;
  useEffect(() => {
    if (!email || !waitingForCode) return;
    const timer = setInterval(() => void email.run().catch(() => undefined), POLL_MS);
    return () => clearInterval(timer);
  }, [email, waitingForCode]);

  if (!email) return null;

  return (
    <div className="mt-3 flex flex-col gap-3">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">How do you want to send job emails?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={provider === p.id}
              onClick={() => save({ provider: p.id, done: setup.done })}
              className={clsx(
                'border-line rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                provider === p.id ? 'border-accent bg-accent-soft' : 'hover:bg-surface-2',
              )}
            >
              <span className="block font-medium">{p.label}</span>
              <span className="text-muted block text-xs">{p.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {provider === 'manual' ? (
        <Steps>
          <Step n={1} title="Save the address as a contact" done={done.has('contact')}>
            <p>So it’s quick to pick when you forward. Name it “Rolestash”.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                icon={<UserPlus className="size-3.5" />}
                disabled={!address}
                onClick={() => {
                  if (address) downloadContact(address);
                  tick('contact');
                }}
              >
                Download contact card
              </Button>
              <CopyButton text={address} label="Copy address" />
            </div>
          </Step>
          <Step n={2} title="Forward job emails to Rolestash" done={working}>
            <p>
              When an employer writes (“we’d like to interview you”, “unfortunately…”), press{' '}
              <b>Forward</b> and send it to Rolestash. Your board updates within a minute.
            </p>
          </Step>
        </Steps>
      ) : null}

      {provider === 'gmail' ? (
        <Steps>
          <Step
            n={1}
            title="Add Rolestash as a forwarding address"
            done={done.has('forward') || !!code || working}
          >
            <p>
              Open Gmail’s forwarding settings, click <b>Add a forwarding address</b>, paste your
              address, then <b>Next</b> and <b>Proceed</b>.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <CopyButton text={address} label="Copy address" />
              <ButtonLink
                size="sm"
                href={GMAIL_FORWARDING}
                icon={<ExternalLink className="size-3.5" />}
                onClick={() => tick('forward')}
              >
                Open Gmail forwarding
              </ButtonLink>
            </div>
          </Step>
          <Step n={2} title="Enter Gmail’s confirmation code" done={done.has('confirm') || working}>
            {code || confirmUrl ? (
              <>
                <p>
                  Gmail sent a code to Rolestash. Paste it into the box in Gmail and click Verify.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {code ? (
                    <>
                      <code className="bg-surface-2 rounded-lg px-3 py-1.5 text-lg font-semibold tracking-widest">
                        {code}
                      </code>
                      <CopyButton text={code} label="Copy code" />
                    </>
                  ) : null}
                  {confirmUrl ? (
                    <ButtonLink
                      size="sm"
                      href={confirmUrl}
                      icon={<ExternalLink className="size-3.5" />}
                    >
                      Or confirm with Google
                    </ButtonLink>
                  ) : null}
                  <Button size="sm" variant="ghost" onClick={() => tick('confirm')}>
                    Done
                  </Button>
                </div>
              </>
            ) : (
              <p className="flex items-center gap-2">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                {done.has('forward')
                  ? 'Waiting for Gmail’s code. It usually arrives within a minute.'
                  : 'The code appears here after step 1.'}
              </p>
            )}
          </Step>
          <Step n={3} title="Forward job emails automatically" done={done.has('filter')}>
            <p>
              Open this search in Gmail. Click the <b>⚙ sliders</b> at the right of the search box,
              then <b>Create filter</b>, tick <b>Forward it to</b>, choose your Rolestash address
              and click <b>Create filter</b>.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <ButtonLink
                size="sm"
                href={GMAIL_SEARCH}
                icon={<ExternalLink className="size-3.5" />}
                onClick={() => tick('filter')}
              >
                Open the search in Gmail
              </ButtonLink>
              <CopyButton text={GMAIL_QUERY} label="Copy search" />
            </div>
          </Step>
          <TestStep n={4} state={state} />
        </Steps>
      ) : null}

      {provider === 'outlook' ? (
        <Steps>
          <Step n={1} title="Create a forwarding rule" done={done.has('rule')}>
            <p>
              Open Outlook’s rules, click <b>Add new rule</b>, name it “Rolestash”, choose{' '}
              <b>From</b> and paste the senders below. Then add the action <b>Forward to</b> and
              paste your address.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <ButtonLink
                size="sm"
                href={OUTLOOK_RULES}
                icon={<ExternalLink className="size-3.5" />}
                onClick={() => tick('rule')}
              >
                Open Outlook rules
              </ButtonLink>
              <CopyButton text={SUGGESTED_SENDERS.join('; ')} label="Copy senders" />
              <CopyButton text={address} label="Copy address" />
            </div>
            <p className="text-subtle mt-2 text-xs">
              Some work accounts block forwarding outside the organisation. If yours does, choose
              “I’ll forward emails myself”.
            </p>
          </Step>
          <TestStep n={2} state={state} />
        </Steps>
      ) : null}
    </div>
  );
}

function TestStep({ n, state }: { n: number; state: EmailUpdateState | undefined }) {
  const last = state?.lastEmailAt;
  const working = last !== undefined;
  return (
    <Step n={n} title={working ? 'It’s working' : 'Try it'} done={working}>
      {working ? (
        <p>Last email {relativeTime(last)}.</p>
      ) : (
        <p>
          Filters only catch new mail. To check now, forward one job email to Rolestash by hand; it
          shows up here within a minute.
        </p>
      )}
    </Step>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="flex flex-col gap-3">{children}</ol>;
}

function Step({
  n,
  title,
  done,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className={clsx(
          'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
          done ? 'bg-accent text-white dark:text-zinc-950' : 'bg-surface-2 text-muted',
        )}
      >
        {done ? <Check className="size-3.5" /> : n}
      </span>
      <div className="min-w-0 flex-1 text-[13px]">
        <p className="text-sm font-medium">
          {title}
          {done ? <span className="sr-only"> (done)</span> : null}
        </p>
        <div className="text-muted mt-0.5">{children}</div>
      </div>
    </li>
  );
}

function CopyButton({ text, label }: { text: string | undefined; label: string }) {
  const toast = useToast();
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={<Copy className="size-3.5" />}
      disabled={!text}
      onClick={() =>
        void navigator.clipboard
          .writeText(text ?? '')
          .then(() => toast({ message: 'Copied', tone: 'success' }))
      }
    >
      {label}
    </Button>
  );
}

/** A contact card (.vcf) for the forwarding address, made on this device. */
function downloadContact(address: string) {
  const card = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN:Rolestash',
    `EMAIL;TYPE=INTERNET:${address}`,
    'END:VCARD',
  ].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([card], { type: 'text/vcard' }));
  a.download = 'Rolestash.vcf';
  a.click();
  URL.revokeObjectURL(a.href);
}
