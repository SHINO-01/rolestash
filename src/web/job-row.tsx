import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';
import type { Job } from '@/domain/job';
import type { Stage } from '@/domain/stage';
import { formatSalary } from '@/extraction';
import { CompanyAvatar } from '@/ui/components/company-avatar';
import { InterviewChip } from '@/features/email/interview';
import { SuggestionChip } from '@/features/email/suggestion';
import { STAGE_STYLE } from '@/ui/stage-style';

/** A tappable job in the web board's lists: big enough for a thumb. */
export function JobRow({
  job,
  stages,
  note,
  urgent = false,
  showStage = true,
  onOpen,
}: {
  job: Job;
  stages: readonly Stage[];
  note?: string;
  urgent?: boolean;
  showStage?: boolean;
  onOpen: (id: string) => void;
}) {
  const stage = stages.find((s) => s.id === job.stageId);
  const salary = formatSalary(job.salary);
  const detail = [job.company || job.source.siteName, job.location, salary]
    .filter(Boolean)
    .join(' · ');
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(job.id)}
        className="bg-surface border-line shadow-card flex min-h-16 w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left"
      >
        <CompanyAvatar company={job.company || job.source.siteName} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{job.title}</span>
          <span className="text-muted block truncate text-xs">{detail}</span>
          {job.suggestion || job.interview ? (
            <span className="mt-1 flex flex-wrap gap-1">
              <SuggestionChip job={job} />
              <InterviewChip job={job} />
            </span>
          ) : null}
          {note || (showStage && stage) ? (
            <span className="mt-1 flex items-center gap-2 text-xs">
              {showStage && stage ? (
                <span className="text-subtle flex items-center gap-1">
                  <span className={clsx('size-1.5 rounded-full', STAGE_STYLE[stage.color].dot)} />
                  {stage.name}
                </span>
              ) : null}
              {note ? (
                <span
                  className={clsx(
                    'font-medium',
                    urgent ? 'text-rose-600 dark:text-rose-400' : 'text-accent',
                  )}
                >
                  {note}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
        <ChevronRight className="text-subtle size-4 shrink-0" />
      </button>
    </li>
  );
}
