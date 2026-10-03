import { Bug, Check, Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BUG_REPORT_MAX, describeContext, type ReportContext } from '@/domain/feedback';
import { BackendError } from '@/services/backend/supabase-client';
import type { FeedbackService } from '@/services/feedback-service';
import { Button, ButtonLink } from '@/ui/components/button';
import { Field, Input, Textarea } from '@/ui/components/field';
import { Dialog } from '@/ui/components/overlay';

const SUPPORT = 'support@rolestash.com';

/**
 * "Report a problem" (ADR-0024). Shows exactly what is sent alongside the
 * message (version, browser, plan, where, and the page only if ticked). Never
 * the jobs. Builds without a backend fall back to a prefilled email.
 */
export function ReportDialog({
  open,
  onClose,
  feedback,
  where,
  email,
  page,
}: {
  open: boolean;
  onClose: () => void;
  feedback: FeedbackService;
  where: ReportContext['where'];
  /** The account's email, prefilled for replies. */
  email?: string;
  /** The current page's address (popup only), offered as an opt-in. */
  page?: string;
}) {
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState(email ?? '');
  const [withPage, setWithPage] = useState(false);
  const [context, setContext] = useState<ReportContext>();
  const [state, setState] = useState<
    | { kind: 'editing' }
    | { kind: 'sending' }
    | { kind: 'sent'; id: number }
    | { kind: 'error'; text: string }
  >({ kind: 'editing' });

  useEffect(() => {
    if (!open) return;
    let live = true;
    void feedback
      .reportContext(where, withPage ? page : undefined)
      .then((next) => live && setContext(next));
    return () => {
      live = false;
    };
  }, [open, feedback, where, page, withPage]);

  /** Closing starts the next report afresh (a sent one, or a failed one). */
  function close() {
    if (state.kind === 'sent' || state.kind === 'error') setState({ kind: 'editing' });
    setContact(email ?? '');
    onClose();
  }

  const trimmed = message.trim();
  const tooLong = trimmed.length > BUG_REPORT_MAX;

  async function send() {
    if (!context || !trimmed || tooLong) return;
    setState({ kind: 'sending' });
    try {
      const id = await feedback.report({ message: trimmed, contactEmail: contact, context });
      setState({ kind: 'sent', id });
      setMessage('');
    } catch (e) {
      setState({
        kind: 'error',
        text:
          e instanceof BackendError && e.code === 'rate_limited'
            ? 'That’s a lot of reports in a short time. Please try again in an hour, or email us.'
            : e instanceof BackendError && e.code === 'network'
              ? 'You seem to be offline. Your message is still here; try again when you’re connected.'
              : 'We couldn’t send that. Please try again, or email us.',
      });
    }
  }

  const mailto = `mailto:${SUPPORT}?subject=${encodeURIComponent('Rolestash problem')}&body=${encodeURIComponent(
    `${trimmed}\n\n--\n${(context ? describeContext(context) : []).map(([k, v]) => `${k}: ${v}`).join('\n')}`,
  )}`;

  if (state.kind === 'sent') {
    return (
      <Dialog open={open} onClose={close} title="Thanks, we’ve got it">
        <div className="flex items-start gap-3">
          <span className="bg-accent-soft text-accent flex size-9 shrink-0 items-center justify-center rounded-xl">
            <Check className="size-[18px]" />
          </span>
          <p className="text-muted text-sm">
            Report #{state.id} is with a real person.{' '}
            {contact.trim()
              ? `We’ll reply to ${contact.trim()} if we need more detail.`
              : 'You didn’t leave an email address, so we can’t reply, but we’ll look into it.'}{' '}
            Fixes are listed in the changelog.
          </p>
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={close}>Close</Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Report a problem"
      description="Tell us what happened. A real person reads every report."
      footer={
        feedback.canSendReports ? (
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={<Bug className="size-4" />}
              disabled={!trimmed || tooLong || state.kind === 'sending'}
              onClick={() => void send()}
            >
              {state.kind === 'sending' ? 'Sending…' : 'Send report'}
            </Button>
          </>
        ) : (
          <ButtonLink variant="primary" icon={<Mail className="size-4" />} href={mailto}>
            Email this to us
          </ButtonLink>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="What happened?"
          hint={
            tooLong
              ? `Please keep it under ${String(BUG_REPORT_MAX)} characters.`
              : 'What you did, what you expected, and what happened instead.'
          }
        >
          {(id) => (
            <Textarea
              id={id}
              rows={5}
              value={message}
              autoFocus
              onChange={(e) => setMessage(e.target.value)}
              placeholder="I saved a job from a careers page and the salary came out empty…"
            />
          )}
        </Field>
        {feedback.canSendReports ? (
          <Field label="Email for our reply (optional)">
            {(id) => (
              <Input
                id={id}
                type="email"
                autoComplete="email"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="you@example.com"
              />
            )}
          </Field>
        ) : null}
        {page ? (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-accent mt-0.5"
              checked={withPage}
              onChange={(e) => setWithPage(e.target.checked)}
            />
            <span>
              Include this page’s address
              <span className="text-subtle block text-xs break-all">{page}</span>
            </span>
          </label>
        ) : null}
        {context ? (
          <div className="bg-surface-2/60 rounded-lg px-3 py-2.5">
            <p className="text-muted mb-1 text-xs font-medium">We’ll also send</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
              {describeContext(context).map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-subtle">{label}</dt>
                  <dd className="text-muted truncate">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-subtle mt-1.5 text-xs">Never your jobs, notes or profile.</p>
          </div>
        ) : null}
        {state.kind === 'error' ? (
          <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
            {state.text}{' '}
            <a className="underline" href={mailto}>
              Email us instead
            </a>
            .
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
