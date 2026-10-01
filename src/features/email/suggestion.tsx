import { Check, Mail, X } from 'lucide-react';
import { useState } from 'react';
import type { EmailNote, Job } from '@/domain/job';
import type { Stage } from '@/domain/stage';
import { Button } from '@/ui/components/button';
import { Chip } from '@/ui/components/chip';
import { useToast } from '@/ui/components/toast';
import { useLiveJobs, useServices } from '@/ui/hooks/services';
import { formatInterviewTime, INTENT_LABEL, senderName } from './email-copy';

/** The email behind an update, in one line. */
export function EmailLine({ email }: { email: EmailNote }) {
  return (
    <span className="text-subtle inline-flex min-w-0 items-center gap-1 text-xs">
      <Mail className="size-3 shrink-0" />
      <span className="truncate" title={`${email.sender}: ${email.subject}`}>
        {senderName(email.sender)} · “{email.subject}”
      </span>
    </span>
  );
}

/** The card's badge while a suggestion waits. */
export function SuggestionChip({ job }: { job: Job }) {
  if (!job.suggestion) return null;
  return (
    <Chip tone="accent" icon={<Mail className="size-3" />}>
      {INTENT_LABEL[job.suggestion.email.intent]}?
    </Chip>
  );
}

/** Accept or dismiss a suggested email update, in the job's details. */
export function SuggestionBanner({ job, stages }: { job: Job; stages: readonly Stage[] }) {
  const { jobService } = useServices();
  const live = useLiveJobs();
  const toast = useToast();
  const [busy, setBusy] = useState<'accept' | 'dismiss' | null>(null);
  const suggestion = job.suggestion;
  if (!suggestion) return null;

  const stage = stages.find((s) => s.id === suggestion.toStageId);
  const when = suggestion.interview ? formatInterviewTime(suggestion.interview) : undefined;
  const what = [
    stage ? `move to ${stage.name}` : undefined,
    when ? `interview ${when}` : suggestion.interview ? 'add the interview' : undefined,
  ]
    .filter(Boolean)
    .join(' and ');

  async function act(kind: 'accept' | 'dismiss') {
    setBusy(kind);
    try {
      const next =
        kind === 'accept'
          ? await jobService.acceptSuggestion(job.id)
          : await jobService.dismissSuggestion(job.id);
      live.applyLocal([next]);
    } catch {
      toast({ message: 'Could not update the job', tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      role="region"
      aria-label="Suggested update from email"
      className="border-accent/30 bg-accent-soft/60 rounded-xl border p-3.5"
    >
      <p className="text-sm">
        <span className="font-semibold">Looks like: {INTENT_LABEL[suggestion.email.intent]}.</span>{' '}
        {what ? `Accept to ${what}.` : null}
      </p>
      <div className="mt-1">
        <EmailLine email={suggestion.email} />
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          variant="primary"
          icon={<Check className="size-3.5" />}
          loading={busy === 'accept'}
          disabled={busy !== null}
          onClick={() => void act('accept')}
        >
          Accept
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<X className="size-3.5" />}
          loading={busy === 'dismiss'}
          disabled={busy !== null}
          onClick={() => void act('dismiss')}
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}
