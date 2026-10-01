import { BellRing, CalendarClock, History } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Job } from '@/domain/job';
import { closesIn, closingSoon, daysUntilClose } from '@/domain/reminders';
import { visibleStages } from '@/domain/stage';
import { useJobs, useSettings } from '@/ui/hooks/services';
import { relativeTime } from '@/ui/format';
import { STAGE_STYLE } from '@/ui/stage-style';
import { JobRow } from './job-row';

/** Follow-ups due within this many days show on Today. */
const FOLLOW_UP_HORIZON = 7;
const RECENT = 5;

/**
 * What needs you today (ADR-0017): follow-ups due or coming up, saved jobs
 * closing soon, where everything stands, and what moved recently.
 */
export function TodayView({
  onOpen,
  onShowStage,
}: {
  onOpen: (id: string) => void;
  onShowStage: (stageId: string) => void;
}) {
  const { jobs } = useJobs();
  const { stages } = useSettings();
  const now = new Date();
  const live = jobs.filter((j) => !j.archivedAt);

  const followUps = live
    .filter((j) => j.followUpAt && daysUntilClose(j.followUpAt, now) <= FOLLOW_UP_HORIZON)
    .sort((a, b) => (a.followUpAt ?? '').localeCompare(b.followUpAt ?? ''));
  const closing = closingSoon(live, stages, now);
  const recent = [...live].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, RECENT);
  const counts = visibleStages(stages)
    .map((s) => ({ stage: s, count: live.filter((j) => j.stageId === s.id).length }))
    .filter((c) => c.count > 0);

  const followUpNote = (job: Job) => {
    const days = daysUntilClose(job.followUpAt ?? '', now);
    return days < 0
      ? 'Follow-up overdue'
      : days === 0
        ? 'Follow up today'
        : `Follow up ${closesIn(days)}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Where things stand">
        <h1 className="text-xl font-semibold">Today</h1>
        <p className="text-muted mt-0.5 text-sm">
          {live.length === 0
            ? 'Your board is empty. Save jobs with the Rolestash extension, or tap + to add one.'
            : `${String(live.length)} job${live.length === 1 ? '' : 's'} on your board.`}
        </p>
        {counts.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {counts.map(({ stage, count }) => (
              <button
                key={stage.id}
                type="button"
                onClick={() => onShowStage(stage.id)}
                className="bg-surface border-line flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm"
              >
                <span className={`size-2 rounded-full ${STAGE_STYLE[stage.color].dot}`} />
                {stage.name}
                <span className="text-subtle font-medium">{count}</span>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {followUps.length || closing.length ? null : live.length ? (
        <p className="bg-accent-soft text-accent-ink rounded-xl px-4 py-3 text-sm">
          All caught up: no follow-ups due and nothing closing in the next 3 days.
        </p>
      ) : null}

      {followUps.length ? (
        <Group icon={<BellRing className="size-4" />} title="Follow-ups">
          {followUps.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              stages={stages}
              note={followUpNote(job)}
              urgent={daysUntilClose(job.followUpAt ?? '', now) <= 0}
              onOpen={onOpen}
            />
          ))}
        </Group>
      ) : null}

      {closing.length ? (
        <Group icon={<CalendarClock className="size-4" />} title="Closing soon: not applied yet">
          {closing.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              stages={stages}
              note={`Closes ${closesIn(daysUntilClose(job.closesAt ?? '', now))}`}
              urgent={daysUntilClose(job.closesAt ?? '', now) <= 1}
              onOpen={onOpen}
            />
          ))}
        </Group>
      ) : null}

      {recent.length ? (
        <Group icon={<History className="size-4" />} title="Recently updated">
          {recent.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              stages={stages}
              note={`Updated ${relativeTime(job.updatedAt)}`}
              onOpen={onOpen}
            />
          ))}
        </Group>
      ) : null}
    </div>
  );
}

function Group({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="text-muted mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
        {icon}
        {title}
      </h2>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}
