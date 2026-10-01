import clsx from 'clsx';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { visibleStages } from '@/domain/stage';
import { useJobs, useSettings } from '@/ui/hooks/services';
import { matchesQuery } from '@/ui/format';
import { STAGE_STYLE } from '@/ui/stage-style';
import { JobRow } from './job-row';

/**
 * The board on a phone (ADR-0017): one column at a time, picked from
 * swipeable tabs, newest first, with search across every column.
 */
export function BoardView({
  onOpen,
  stage,
  onStage,
}: {
  onOpen: (id: string) => void;
  stage: string | undefined;
  onStage: (id: string) => void;
}) {
  const { jobs } = useJobs();
  const settings = useSettings();
  const [query, setQuery] = useState('');
  const stages = visibleStages(settings.stages);
  const live = jobs.filter((j) => !j.archivedAt);
  const current = stages.find((s) => s.id === stage) ?? stages[0];
  const searching = query.trim() !== '';
  const shown = (
    searching
      ? live.filter((j) => matchesQuery(j, query))
      : live.filter((j) => j.stageId === current?.id)
  ).sort((a, b) => (searching ? b.updatedAt.localeCompare(a.updatedAt) : a.rank - b.rank));

  return (
    <div className="flex flex-col gap-3">
      <label className="relative block">
        <span className="sr-only">Search jobs</span>
        <Search className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search jobs, companies, tags…"
          className="bg-surface border-line focus:border-accent h-11 w-full rounded-xl border pr-3 pl-9 text-[15px] focus:outline-none"
        />
      </label>

      {!searching ? (
        <div
          role="tablist"
          aria-label="Columns"
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
        >
          {stages.map((s) => {
            const count = live.filter((j) => j.stageId === s.id).length;
            const selected = s.id === current?.id;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => onStage(s.id)}
                className={clsx(
                  'flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm font-medium',
                  selected
                    ? 'bg-ink text-canvas border-transparent'
                    : 'bg-surface border-line text-muted',
                )}
              >
                <span className={clsx('size-2 rounded-full', STAGE_STYLE[s.color].dot)} />
                {s.name}
                <span className={selected ? 'opacity-70' : 'text-subtle'}>{count}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {shown.length === 0 ? (
        <p className="text-muted py-10 text-center text-sm">
          {searching
            ? 'No jobs match that search.'
            : `Nothing in ${current?.name ?? 'this column'}.`}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              stages={settings.stages}
              showStage={searching}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
