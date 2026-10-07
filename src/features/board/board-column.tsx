import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import clsx from 'clsx';
import type { Job } from '@/domain/job';
import type { Stage } from '@/domain/stage';
import { STAGE_STYLE } from '@/ui/stage-style';
import { COLUMN_PAGE } from './board-columns';
import { SortableJobCard } from './job-card';

export function BoardColumn({
  stage,
  jobIds,
  total,
  more,
  onShowMore,
  jobsById,
  onOpen,
  filtered,
}: {
  stage: Stage;
  /** The cards shown, in order. */
  jobIds: string[];
  /** All jobs in the column, shown or not. */
  total: number;
  /** Cards not shown yet. */
  more: number;
  onShowMore: () => void;
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
        // 288px when there's room; five lanes shrink to fit a 1280px window before it scrolls.
        'flex max-h-full w-[288px] min-w-[232px] shrink flex-col rounded-2xl transition-colors',
        isOver ? 'bg-accent-soft/60' : 'bg-surface-2/70',
      )}
    >
      <header className="flex items-center gap-2 px-3.5 pt-3 pb-2">
        <span className={clsx('size-2 rounded-full', style.dot)} />
        <h2 className={clsx('text-[13px] font-semibold', stage.kind === 'lost' && 'text-muted')}>
          {stage.name}
        </h2>
        <span className="text-subtle bg-surface-3/70 ml-auto rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums">
          {total}
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
          {more > 0 ? (
            <button
              type="button"
              onClick={onShowMore}
              className="text-muted hover:text-ink hover:bg-surface-3/70 rounded-lg py-1.5 text-xs font-medium"
            >
              {more > COLUMN_PAGE
                ? `Show ${String(COLUMN_PAGE)} more of ${String(more)}`
                : `Show ${String(more)} more`}
            </button>
          ) : null}
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
