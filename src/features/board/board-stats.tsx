import { useMemo } from 'react';
import type { Job } from '@/domain/job';
import type { Stage } from '@/domain/stage';
import { computeStats } from './stats';

export function BoardStats({ jobs, stages }: { jobs: readonly Job[]; stages: readonly Stage[] }) {
  const stats = useMemo(() => computeStats(jobs, stages), [jobs, stages]);
  const items = [
    ['Active', stats.active],
    ['Applied this week', stats.appliedThisWeek],
    ['Interviewing', stats.interviewing],
    ['Offers', stats.offers],
  ] as const;
  return (
    <dl className="mr-2 hidden items-center gap-5 whitespace-nowrap xl:flex">
      {items.map(([label, value]) => (
        <div key={label} className="flex items-baseline gap-1.5">
          <dd className="text-sm font-semibold tabular-nums">{value}</dd>
          <dt className="text-subtle text-xs">{label}</dt>
        </div>
      ))}
    </dl>
  );
}
