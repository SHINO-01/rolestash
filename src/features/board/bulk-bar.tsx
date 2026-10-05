import { Archive, Tag, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { visibleStages, type Stage } from '@/domain/stage';
import { Button, IconButton } from '@/ui/components/button';
import { Input, Select } from '@/ui/components/field';
import { useToast } from '@/ui/components/toast';
import { useLiveJobs, useServices } from '@/ui/hooks/services';

/**
 * Bulk actions for the selected cards (Pro): move, tag, archive, delete.
 * Deleting can be undone from the toast.
 */
export function BulkBar({
  selected,
  stages,
  onDone,
}: {
  selected: readonly string[];
  stages: readonly Stage[];
  onDone: () => void;
}) {
  const { jobService } = useServices();
  const live = useLiveJobs();
  const toast = useToast();
  const [tagging, setTagging] = useState(false);
  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);
  const count = selected.length;
  const noun = count === 1 ? 'job' : 'jobs';

  async function run(task: () => Promise<void>) {
    setBusy(true);
    try {
      await task();
    } catch {
      toast({ message: 'Couldn’t update every job', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const move = (stageId: string) =>
    run(async () => {
      live.applyLocal(await jobService.moveMany(selected, stageId));
      toast({
        message: `Moved ${String(count)} ${noun} to ${stages.find((s) => s.id === stageId)?.name ?? 'the column'}`,
        tone: 'success',
      });
      onDone();
    });

  const addTag = () =>
    run(async () => {
      const clean = tag.trim().replace(/^#/, '');
      if (!clean) return;
      live.applyLocal(await jobService.tagMany(selected, clean));
      toast({ message: `Tagged ${String(count)} ${noun} #${clean}`, tone: 'success' });
      setTag('');
      setTagging(false);
      onDone();
    });

  const archive = () =>
    run(async () => {
      live.applyLocal(await jobService.archiveMany(selected));
      toast({
        message: `Archived ${String(count)} ${noun}. Find them under History.`,
        tone: 'success',
      });
      onDone();
    });

  const remove = () =>
    run(async () => {
      const removed = await jobService.removeMany(selected);
      live.applyLocal(
        [],
        removed.map((j) => j.id),
      );
      onDone();
      toast({
        message: `Deleted ${String(removed.length)} ${removed.length === 1 ? 'job' : 'jobs'}`,
        action: {
          label: 'Undo',
          onClick: () => void jobService.restoreMany(removed).then((jobs) => live.applyLocal(jobs)),
        },
        durationMs: 10_000,
      });
    });

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="bg-surface border-line shadow-pop fixed bottom-5 left-1/2 z-20 flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-2xl border px-3 py-2"
    >
      <span className="px-1 text-sm font-semibold tabular-nums">{count} selected</span>
      <label>
        <span className="sr-only">Move to</span>
        <Select
          className="h-8 w-auto text-[13px]"
          value=""
          disabled={busy}
          onChange={(e) => e.target.value && void move(e.target.value)}
        >
          <option value="">Move to…</option>
          {visibleStages(stages).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </label>
      {tagging ? (
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            void addTag();
          }}
        >
          <Input
            autoFocus
            aria-label="Tag"
            className="h-8 w-32 text-[13px]"
            placeholder="Tag"
            value={tag}
            maxLength={40}
            onChange={(e) => setTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              e.stopPropagation();
              setTagging(false);
            }}
          />
          <Button size="sm" type="submit" disabled={busy || !tag.trim()}>
            Add
          </Button>
        </form>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          icon={<Tag className="size-3.5" />}
          disabled={busy}
          onClick={() => setTagging(true)}
        >
          Add tag
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        icon={<Archive className="size-3.5" />}
        disabled={busy}
        onClick={() => void archive()}
      >
        Archive
      </Button>
      <Button
        size="sm"
        variant="danger"
        icon={<Trash2 className="size-3.5" />}
        disabled={busy}
        onClick={() => void remove()}
      >
        Delete
      </Button>
      <IconButton size="sm" label="Clear selection" onClick={onDone}>
        <X className="size-4" />
      </IconButton>
    </div>
  );
}
