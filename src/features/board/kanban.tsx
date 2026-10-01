import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useMemo, useState } from 'react';
import type { Job } from '@/domain/job';
import type { Settings } from '@/domain/settings';
import { visibleStages } from '@/domain/stage';
import { useToast } from '@/ui/components/toast';
import { useLiveJobs, useServices } from '@/ui/hooks/services';
import { BoardColumn } from './board-column';
import { findColumn, groupIntoColumns, resolveDropIndex, type Columns } from './board-columns';
import { JobCard } from './job-card';

/**
 * Multi-column sortable board. During a drag we work on a local copy of the
 * column layout; on drop we persist one move and apply it optimistically.
 */
export function Kanban({
  settings,
  allJobs,
  visibleJobs,
  filtered,
  onOpen,
}: {
  settings: Settings;
  allJobs: readonly Job[];
  visibleJobs: readonly Job[];
  filtered: boolean;
  onOpen: (id: string) => void;
}) {
  const { jobService } = useServices();
  const live = useLiveJobs();
  const toast = useToast();

  const baseColumns = useMemo(
    () => groupIntoColumns(visibleStages(settings.stages), visibleJobs, settings.defaultStageId),
    [settings, visibleJobs],
  );
  const jobsById = useMemo(() => new Map(allJobs.map((j) => [j.id, j])), [allJobs]);
  const [dragColumns, setDragColumns] = useState<Columns | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const columns = dragColumns ?? baseColumns;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  );

  function onDragStart({ active }: DragStartEvent) {
    setActiveId(String(active.id));
    setDragColumns(baseColumns);
  }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    setDragColumns((prev) => {
      const cols = prev ?? baseColumns;
      const activeKey = String(active.id);
      const from = findColumn(cols, activeKey);
      const to = findColumn(cols, String(over.id));
      if (!from || !to || from === to) return cols;
      const toItems = [...(cols[to] ?? [])];
      const overIndex = toItems.indexOf(String(over.id));
      const isBelow =
        over.rect.top + over.rect.height / 2 <
        (active.rect.current.translated?.top ?? 0) +
          (active.rect.current.translated?.height ?? 0) / 2;
      const insertAt = overIndex >= 0 ? overIndex + (isBelow ? 1 : 0) : toItems.length;
      toItems.splice(insertAt, 0, activeKey);
      return {
        ...cols,
        [from]: (cols[from] ?? []).filter((id) => id !== activeKey),
        [to]: toItems,
      };
    });
  }

  function reset() {
    setActiveId(null);
    setDragColumns(null);
  }

  async function onDragEnd({ active, over }: DragEndEvent) {
    const id = String(active.id);
    const cols = dragColumns ?? baseColumns;
    const container = findColumn(cols, id);
    const job = jobsById.get(id);
    if (!over || !container || !job) {
      reset();
      return;
    }

    let items = cols[container] ?? [];
    if (findColumn(cols, String(over.id)) === container && over.id !== container) {
      const oldIndex = items.indexOf(id);
      const newIndex = items.indexOf(String(over.id));
      if (oldIndex !== newIndex && newIndex >= 0) items = arrayMove(items, oldIndex, newIndex);
    }
    setDragColumns({ ...cols, [container]: items });
    setActiveId(null);

    const position = items.indexOf(id);
    const unchanged = job.stageId === container && baseColumns[container]?.indexOf(id) === position;
    if (unchanged) {
      reset();
      return;
    }

    const index = resolveDropIndex(
      allJobs.filter((j) => j.stageId === container),
      id,
      items[position - 1],
      items[position + 1],
    );
    try {
      const changed = await jobService.move(id, container, index);
      live.applyLocal(changed);
      if (job.stageId !== container) {
        const stage = settings.stages.find((s) => s.id === container);
        toast({
          message: `Moved to ${stage?.name ?? container}`,
          tone: 'success',
          durationMs: 2500,
        });
      }
    } catch (error) {
      toast({ message: error instanceof Error ? error.message : 'Move failed', tone: 'error' });
    } finally {
      setDragColumns(null);
    }
  }

  const activeJob = activeId ? jobsById.get(activeId) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={(e) => void onDragEnd(e)}
      onDragCancel={reset}
    >
      <div className="flex h-full scrollbar-thin items-start gap-3 overflow-x-auto px-6 pb-6">
        {visibleStages(settings.stages).map((stage) => (
          <BoardColumn
            key={stage.id}
            stage={stage}
            jobIds={columns[stage.id] ?? []}
            jobsById={jobsById}
            onOpen={onOpen}
            filtered={filtered}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }}>
        {activeJob ? (
          <div className="w-[272px]">
            <JobCard job={activeJob} lifted />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
