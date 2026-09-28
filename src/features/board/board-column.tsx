import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import clsx from 'clsx';
import type { Job } from '@/domain/job';
import type { Stage } from '@/domain/stage';
import { STAGE_STYLE } from '@/ui/stage-style';
import { SortableJobCard } from './job-card';

export function BoardColumn({
  stage,
  jobIds,
  jobsById,
  onOpen,
  filtered,
}: {
  stage: Stage;
  jobIds: string[];
  jobsById: Map<string, Job>;
  onOpen: (id: string) => void;
  filtered: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const style = STAGE_STYLE[stage.color];

  return (
    <section
      aria-label={`${stage.name} column`}
      className={clsx(
        'flex max-h-full w-[288px] shrink-0 flex-col rounded-2xl transition-colors',
        isOver ? 'bg-accent-soft/60' : 'bg-surface-2/70',
      )}
    >
      <header className="flex items-center gap-2 px-3.5 pt-3 pb-2">
        <span className={clsx('size-2 rounded-full', style.dot)} />
        <h2 className={clsx('text-[13px] font-semibold', stage.kind === 'lost' && 'text-muted')}>
          {stage.name}
        </h2>
        <span className="text-subtle bg-surface-3/70 ml-auto rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums">
          {jobIds.length}
        </span>
      </header>

      <SortableContext id={stage.id} items={jobIds} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className="flex min-h-24 flex-1 scrollbar-thin flex-col gap-2 overflow-y-auto px-2 pt-0.5 pb-3"
        >
          {jobIds.map((id) => {
            const job = jobsById.get(id);
            return job ? <SortableJobCard key={id} job={job} onOpen={onOpen} /> : null;
          })}
          {jobIds.length === 0 ? (
            <div className="text-subtle border-line-strong/70 flex h-20 items-center justify-center rounded-xl border border-dashed text-xs">
              {filtered ? 'No matches' : 'Drop jobs here'}
            </div>
          ) : null}
        </div>
      </SortableContext>
    </section>
  );
}
