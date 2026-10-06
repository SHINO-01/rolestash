import { Check, Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Job } from '@/domain/job';
import { findStage } from '@/domain/stage';
import type { UnsortedUpdate } from '@/services/email-update-service';
import { JobLimitError } from '@/services/job-service';
import { limitMessage } from '@/features/account/plan-copy';
import { Button } from '@/ui/components/button';
import { Select } from '@/ui/components/field';
import { Dialog } from '@/ui/components/overlay';
import { useToast } from '@/ui/components/toast';
import { useEmailState } from '@/ui/hooks/email';
import { useJobs, useLiveJobs, useServices, useSettings } from '@/ui/hooks/services';
import { relativeTime } from '@/ui/format';
import { INTENT_LABEL } from './email-copy';

/**
 * Email updates that matched no job clearly (ADR-0014): file each under a
 * job in one click (this device then remembers the sender), add it as a new
 * job, or dismiss it.
 */
export function UnsortedDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const state = useEmailState();
  const { jobs } = useJobs();
  const unsorted = [...(state?.unsorted ?? [])].reverse();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Unsorted updates"
      description="Emails we couldn’t match to one job with confidence. File each one, and later emails from the same sender follow."
    >
      {unsorted.length === 0 ? (
        <p className="text-muted text-sm">All sorted. New ones appear here when they arrive.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {unsorted.map((item) => (
            <UnsortedItem key={item.id} item={item} jobs={jobs} />
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function UnsortedItem({ item, jobs }: { item: UnsortedUpdate; jobs: Job[] }) {
  const { email } = useServices();
  const live = useLiveJobs();
  const toast = useToast();
  const { stages } = useSettings();
  const options = useMemo(() => {
    const onBoard = jobs.filter((j) => !j.archivedAt);
    const likely = item.candidates
      .map((id) => onBoard.find((j) => j.id === id))
      .filter((j): j is Job => j !== undefined);
    const rest = onBoard
      .filter((j) => !item.candidates.includes(j.id))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { likely, rest };
  }, [jobs, item.candidates]);
  const [jobId, setJobId] = useState(options.likely[0]?.id ?? '');
  const [busy, setBusy] = useState<'assign' | 'add' | 'dismiss' | null>(null);
  if (!email) return null;

  async function act(kind: 'assign' | 'add' | 'dismiss') {
    if (!email) return;
    setBusy(kind);
    try {
      if (kind === 'dismiss') await email.dismissUnsorted(item.id);
      else {
        const job =
          kind === 'assign' ? await email.assign(item.id, jobId) : await email.addJob(item.id);
        live.applyLocal([job]);
        // A rejection puts the job in a column with no lane (ADR-0034): say where it is.
        const stage = findStage(stages, job.stageId);
        toast({
          message:
            stage?.kind === 'lost'
              ? `Filed under ${job.title}, in ${stage.name}. Find it in History.`
              : `Filed under ${job.title}`,
          tone: 'success',
        });
      }
    } catch (error) {
      toast({
        tone: 'error',
        message:
          error instanceof JobLimitError ? limitMessage(error) : 'Could not file this update',
      });
      setBusy(null);
    }
  }

  const label = (j: Job) => (j.company ? `${j.title} · ${j.company}` : j.title);
  return (
    <li className="border-line rounded-xl border p-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{INTENT_LABEL[item.intent]}</span>
        <span className="text-subtle shrink-0 text-xs">{relativeTime(item.receivedAt)}</span>
      </div>
      <p className="text-muted mt-0.5 truncate text-[13px]" title={item.subject}>
        {item.sender.name ?? item.sender.address} · “{item.subject}”
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Job</span>
          <Select
            className="h-8 text-[13px]"
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
          >
            <option value="">Choose a job…</option>
            {options.likely.length ? (
              <optgroup label="Likely">
                {options.likely.map((j) => (
                  <option key={j.id} value={j.id}>
                    {label(j)}
                  </option>
                ))}
              </optgroup>
            ) : null}
            <optgroup label="All jobs">
              {options.rest.map((j) => (
                <option key={j.id} value={j.id}>
                  {label(j)}
                </option>
              ))}
            </optgroup>
          </Select>
        </label>
        <Button
          size="sm"
          variant="primary"
          icon={<Check className="size-3.5" />}
          loading={busy === 'assign'}
          disabled={busy !== null || !jobId}
          onClick={() => void act('assign')}
        >
          File here
        </Button>
      </div>
      <div className="mt-2 flex gap-2">
        <Button
          size="sm"
          variant="ghost"
          icon={<Plus className="size-3.5" />}
          loading={busy === 'add'}
          disabled={busy !== null}
          onClick={() => void act('add')}
        >
          Add this job
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
    </li>
  );
}
