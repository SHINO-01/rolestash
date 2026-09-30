import clsx from 'clsx';
import { ArchiveRestore } from 'lucide-react';
import { useState } from 'react';
import { FREE_HISTORY_DAYS, historyDate, historyView, type HistoryTab } from '@/domain/history';
import type { Job } from '@/domain/job';
import type { Stage } from '@/domain/stage';
import { JobLimitError } from '@/services/job-service';
import { Button } from '@/ui/components/button';
import { CompanyAvatar } from '@/ui/components/company-avatar';
import { Dialog } from '@/ui/components/overlay';
import { useToast } from '@/ui/components/toast';
import { useLiveJobs, useServices } from '@/ui/hooks/services';
import { formatDate } from '@/ui/format';
import { STAGE_STYLE } from '@/ui/stage-style';
import { limitMessage } from '@/features/account/plan-copy';

const TABS: { id: HistoryTab; label: string; empty: string }[] = [
  {
    id: 'finished',
    label: 'Finished',
    empty: 'Jobs you move to Offer, Rejected or Withdrawn show up here.',
  },
  {
    id: 'archived',
    label: 'Archived',
    empty: 'Archive a job from its details to clear it off the board. It stays here.',
  },
];

/**
 * History: finished and archived jobs (ADR-0013). On Free, only the last 30
 * days show; older ones are counted, never deleted, and always exported.
 */
export function HistoryDialog({
  open,
  onClose,
  jobs,
  stages,
  historyFrom,
  onOpenJob,
  onSeePlans,
}: {
  open: boolean;
  onClose: () => void;
  jobs: readonly Job[];
  stages: readonly Stage[];
  historyFrom: Date | undefined;
  onOpenJob: (id: string) => void;
  onSeePlans?: () => void;
}) {
  const [tab, setTab] = useState<HistoryTab>('finished');
  const { jobService } = useServices();
  const live = useLiveJobs();
  const toast = useToast();
  const view = historyView(jobs, stages, tab, historyFrom);

  async function restore(job: Job) {
    try {
      live.applyLocal([await jobService.unarchive(job.id)]);
      toast({ message: `${job.title} is back on the board`, tone: 'success' });
    } catch (error) {
      toast({
        tone: 'error',
        message: error instanceof JobLimitError ? limitMessage(error) : 'Could not restore the job',
      });
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="History"
      description="Finished and archived jobs. Archived, rejected and withdrawn jobs don't count toward your plan's active jobs."
      className="w-[min(640px,calc(100vw-2rem))]"
    >
      <div
        role="tablist"
        aria-label="History"
        className="bg-surface-2 mb-3 inline-flex rounded-lg p-1"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              'rounded-md px-3 py-1 text-[13px] font-medium transition-colors',
              tab === t.id ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
        {view.jobs.length === 0 ? (
          <p className="text-muted py-8 text-center text-sm">
            {view.hidden > 0
              ? 'Nothing from the last 30 days.'
              : TABS.find((t) => t.id === tab)?.empty}
          </p>
        ) : (
          <ul className="divide-line -mx-2 max-h-[55vh] divide-y overflow-y-auto">
            {view.jobs.map((job) => {
              const stage = stages.find((s) => s.id === job.stageId);
              const at = historyDate(job, stages);
              return (
                <li key={job.id} className="flex items-center gap-3 px-2 py-2.5">
                  <CompanyAvatar company={job.company || job.source.siteName} />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => onOpenJob(job.id)}
                  >
                    <span className="text-ink block truncate text-sm font-medium hover:underline">
                      {job.title}
                    </span>
                    <span className="text-muted block truncate text-xs">
                      {job.company || 'No company'}
                      {stage ? ` · ${stage.name}` : ''}
                      {at
                        ? ` · ${tab === 'archived' ? 'archived' : 'finished'} ${formatDate(at) ?? ''}`
                        : ''}
                    </span>
                  </button>
                  {stage ? (
                    <span
                      className={clsx('size-2 shrink-0 rounded-full', STAGE_STYLE[stage.color].dot)}
                    />
                  ) : null}
                  {job.archivedAt ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<ArchiveRestore className="size-4" />}
                      onClick={() => void restore(job)}
                    >
                      Restore
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {view.hidden > 0 ? <HistoryLimitNote hidden={view.hidden} onSeePlans={onSeePlans} /> : null}
    </Dialog>
  );
}

/** The Free plan's history note: what's hidden, that it's safe, and how to see it. */
export function HistoryLimitNote({
  hidden,
  what = ['job', 'jobs'],
  onSeePlans,
  className,
}: {
  hidden: number;
  /** Singular and plural nouns for what's hidden. */
  what?: readonly [string, string];
  onSeePlans?: (() => void) | undefined;
  className?: string;
}) {
  return (
    <div
      role="note"
      className={clsx(
        'bg-accent-soft text-accent-ink mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3.5 py-2.5 text-[13px]',
        className,
      )}
    >
      <span className="flex-1">
        {hidden} {hidden === 1 ? what[0] : what[1]} from more than {FREE_HISTORY_DAYS} days ago{' '}
        {hidden === 1 ? 'is' : 'are'} kept but hidden on Free. Exports include everything.
      </span>
      {onSeePlans ? (
        <button type="button" className="font-semibold hover:underline" onClick={onSeePlans}>
          See full history with Pro
        </button>
      ) : null}
    </div>
  );
}
