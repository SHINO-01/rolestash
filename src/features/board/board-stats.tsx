import { useMemo } from 'react';
import type { Job } from '@/domain/job';
import type { Stage } from '@/domain/stage';
import { computeStats } from './stats';

export function BoardStats({ jobs, stages }: { jobs: readonly Job[]; stages: readonly Stage[] }) {
  const stats = useMemo(() => computeStats(jobs, stages), [jobs, stages]);
  const items = [
    ['active', stats.active],
    ['applied this week', stats.appliedThisWeek],
    ['interviewing', stats.interviewing],
    [stats.offers === 1 ? 'offer' : 'offers', stats.offers],
  ] as const;
  // A quiet summary under the greeting; zeros other than "active" are left out.
  return (
    <dl className="text-muted flex flex-wrap items-baseline gap-x-3 text-sm">
      {items
        .filter(([label, value]) => label === 'active' || value > 0)
        .map(([label, value]) => (
          <div key={label} className="flex items-baseline gap-1">
            <dd className="text-ink font-medium tabular-nums">{value}</dd>
            <dt>{label}</dt>
          </div>
        ))}
    </dl>
  );
}
