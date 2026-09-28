import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import clsx from 'clsx';
import { CalendarClock, MapPin } from 'lucide-react';
import { memo, type CSSProperties } from 'react';
import type { Job } from '@/domain/job';
import { formatSalary } from '@/extraction';
import { Chip } from '@/ui/components/chip';
import { CompanyAvatar } from '@/ui/components/company-avatar';
import { PriorityBadge } from '@/ui/components/misc';
import { daysUntil, relativeTime, WORKPLACE_LABEL } from '@/ui/format';

export function SortableJobCard({ job, onOpen }: { job: Job; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: job.id,
  });
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(job.id)}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (e.key === 'Enter') onOpen(job.id);
      }}
      aria-label={`${job.title} at ${job.company || 'unknown company'}`}
      className={clsx(
        'focus-visible:ring-accent rounded-xl outline-none focus-visible:ring-2',
        isDragging && 'opacity-40',
      )}
    >
      <JobCard job={job} />
    </div>
  );
}

export const JobCard = memo(function JobCard({
  job,
  lifted = false,
}: {
  job: Job;
  lifted?: boolean;
}) {
  const salary = formatSalary(job.salary);
  const closesIn = daysUntil(job.closesAt);
  const timeLabel = job.appliedAt
    ? `Applied ${relativeTime(job.appliedAt)}`
    : `Saved ${relativeTime(job.createdAt)}`;

  return (
    <article
      className={clsx(
        'group bg-surface border-line cursor-pointer rounded-xl border p-3 transition-[box-shadow,border-color]',
        lifted
          ? 'shadow-lift border-line-strong rotate-[1.5deg]'
          : 'shadow-card hover:border-line-strong hover:shadow-md',
      )}
    >
      <div className="flex gap-2.5">
        <CompanyAvatar company={job.company || job.source.siteName} size="sm" />
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-[13px] leading-snug font-semibold">{job.title}</h3>
          <p className="text-muted mt-0.5 truncate text-xs">{job.company || job.source.siteName}</p>
        </div>
      </div>

      {job.location || job.workplaceType || salary || closesIn !== undefined || job.tags.length ? (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {job.location ? (
            <Chip
              icon={<MapPin className="size-3 shrink-0" />}
              className="max-w-[160px]"
              title={job.location}
            >
              {job.location}
            </Chip>
          ) : null}
          {job.workplaceType ? (
            <Chip tone="accent">{WORKPLACE_LABEL[job.workplaceType]}</Chip>
          ) : null}
          {salary ? <Chip tone="success">{salary}</Chip> : null}
          {closesIn !== undefined && closesIn <= 7 ? (
            <Chip
              tone={closesIn < 0 ? 'neutral' : 'danger'}
              icon={<CalendarClock className="size-3" />}
            >
              {closesIn < 0 ? 'Closed' : closesIn === 0 ? 'Closes today' : `Closes in ${closesIn}d`}
            </Chip>
          ) : null}
          {job.tags.slice(0, 2).map((tag) => (
            <Chip key={tag}>#{tag}</Chip>
          ))}
        </div>
      ) : null}

      <div className="text-subtle mt-2.5 flex items-center justify-between text-[11px]">
        <span>{timeLabel}</span>
        <PriorityBadge value={job.priority} />
      </div>
    </article>
  );
});
