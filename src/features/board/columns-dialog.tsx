import clsx from 'clsx';
import { Archive, ArchiveRestore, ArrowLeft, ArrowRight, Plus, Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import { MAX_STAGE_NAME } from '@/domain/columns';
import type { Settings } from '@/domain/settings';
import { STAGE_COLORS, type Stage, type StageColor, type StageKind } from '@/domain/stage';
import { ColumnError } from '@/services/column-service';
import { Button, IconButton } from '@/ui/components/button';
import { Input, Select } from '@/ui/components/field';
import { Menu } from '@/ui/components/menu';
import { Dialog } from '@/ui/components/overlay';
import { useToast } from '@/ui/components/toast';
import { useServices } from '@/ui/hooks/services';
import { STAGE_STYLE } from '@/ui/stage-style';

const KIND_LABEL: Record<StageKind, string> = {
  active: 'In progress',
  won: 'Finished: success',
  lost: 'Finished: unsuccessful',
};

/**
 * Edit columns (Pro; ADR-0013): rename, recolour, reorder, add, archive and
 * pick where new jobs go. On Free the columns are shown, not editable.
 */
export function ColumnsDialog({
  open,
  onClose,
  settings,
  onSeePlans,
}: {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  onSeePlans?: (() => void) | undefined;
}) {
  const { columns } = useServices();
  const toast = useToast();
  const [canEdit, setCanEdit] = useState<boolean>();

  useEffect(() => {
    if (open) void columns.canEdit().then(setCanEdit);
  }, [open, columns]);

  /** Applies an edit; false (with a toast) when it can't be made. */
  async function run(edit: () => Promise<unknown>): Promise<boolean> {
    try {
      await edit();
      return true;
    } catch (error) {
      toast({
        tone: 'error',
        message: error instanceof ColumnError ? error.message : 'Could not change the columns',
      });
      return false;
    }
  }

  const visible = settings.stages.filter((s) => !s.archived);
  const archived = settings.stages.filter((s) => s.archived);
  const locked = canEdit === false;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Edit columns"
      description="Rename, recolour and reorder your board, or add columns that match your process."
      className="w-[min(600px,calc(100vw-2rem))]"
    >
      {locked ? (
        <div className="bg-accent-soft text-accent-ink mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3.5 py-2.5 text-[13px]">
          <span className="flex-1">
            Custom columns are part of Pro. Your current columns stay exactly as they are.
          </span>
          {onSeePlans ? (
            <button type="button" className="font-semibold hover:underline" onClick={onSeePlans}>
              Try it free
            </button>
          ) : null}
        </div>
      ) : null}

      <ol aria-label="Columns" className="space-y-1.5">
        {visible.map((stage, i) => (
          <ColumnRow
            key={`${stage.id}:${stage.name}`}
            stage={stage}
            isDefault={stage.id === settings.defaultStageId}
            first={i === 0}
            last={i === visible.length - 1}
            disabled={canEdit !== true}
            onRename={(name) => run(() => columns.rename(stage.id, name))}
            onRecolor={(color) => void run(() => columns.recolor(stage.id, color))}
            onMove={(d) => void run(() => columns.move(stage.id, d))}
            onDefault={() => void run(() => columns.setDefault(stage.id))}
            onArchive={() => void run(() => columns.archive(stage.id))}
          />
        ))}
      </ol>

      {archived.length > 0 ? (
        <section className="mt-5">
          <h3 className="text-subtle mb-2 text-[11px] font-semibold tracking-wider uppercase">
            Archived columns
          </h3>
          <ul className="space-y-1">
            {archived.map((stage) => (
              <li key={stage.id} className="flex items-center gap-2.5 px-2 py-1 text-sm">
                <span className={clsx('size-2.5 rounded-full', STAGE_STYLE[stage.color].dot)} />
                <span className="text-muted flex-1">{stage.name}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={canEdit !== true}
                  icon={<ArchiveRestore className="size-4" />}
                  onClick={() => void run(() => columns.restore(stage.id))}
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canEdit ? <AddColumn onAdd={(input) => run(() => columns.add(input))} /> : null}
    </Dialog>
  );
}

function ColumnRow({
  stage,
  isDefault,
  first,
  last,
  disabled,
  onRename,
  onRecolor,
  onMove,
  onDefault,
  onArchive,
}: {
  stage: Stage;
  isDefault: boolean;
  first: boolean;
  last: boolean;
  disabled: boolean;
  onRename: (name: string) => Promise<boolean>;
  onRecolor: (color: StageColor) => void;
  onMove: (direction: -1 | 1) => void;
  onDefault: () => void;
  onArchive: () => void;
}) {
  // Keyed by name in the list, so a saved rename resets this draft.
  const [name, setName] = useState(stage.name);

  const commit = () => {
    if (name.trim() === stage.name) return;
    void onRename(name).then((ok) => {
      if (!ok) setName(stage.name);
    });
  };

  return (
    <li className="border-line bg-surface flex items-center gap-2 rounded-xl border px-2 py-1.5">
      <Menu
        align="start"
        trigger={(props) => (
          <button
            type="button"
            {...props}
            disabled={disabled}
            aria-label={`Colour of ${stage.name}`}
            className="hover:bg-surface-2 grid size-8 place-items-center rounded-lg disabled:opacity-60"
          >
            <span className={clsx('size-3 rounded-full', STAGE_STYLE[stage.color].dot)} />
          </button>
        )}
        items={STAGE_COLORS.map((color) => ({
          label: color.charAt(0).toUpperCase() + color.slice(1),
          icon: <span className={clsx('size-3 rounded-full', STAGE_STYLE[color].dot)} />,
          checked: color === stage.color,
          onSelect: () => onRecolor(color),
        }))}
      />
      <Input
        aria-label={`Name of ${stage.name}`}
        value={name}
        maxLength={MAX_STAGE_NAME}
        disabled={disabled}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setName(stage.name);
        }}
        className="h-8 min-w-0 flex-1"
      />
      <span className="text-subtle hidden w-36 shrink-0 text-xs sm:block">
        {KIND_LABEL[stage.kind]}
        {stage.kind === 'active' && stage.marksApplied ? ', applied' : ''}
      </span>
      <IconButton
        label={isDefault ? `New jobs go to ${stage.name}` : `Send new jobs to ${stage.name}`}
        size="sm"
        disabled={disabled || isDefault || stage.kind === 'lost'}
        aria-pressed={isDefault}
        onClick={onDefault}
      >
        <Star className={clsx('size-4', isDefault && 'fill-amber-400 text-amber-500')} />
      </IconButton>
      <IconButton
        label={`Move ${stage.name} left`}
        size="sm"
        disabled={disabled || first}
        onClick={() => onMove(-1)}
      >
        <ArrowLeft className="size-4" />
      </IconButton>
      <IconButton
        label={`Move ${stage.name} right`}
        size="sm"
        disabled={disabled || last}
        onClick={() => onMove(1)}
      >
        <ArrowRight className="size-4" />
      </IconButton>
      <IconButton label={`Archive ${stage.name}`} size="sm" disabled={disabled} onClick={onArchive}>
        <Archive className="size-4" />
      </IconButton>
    </li>
  );
}

function AddColumn({
  onAdd,
}: {
  onAdd: (input: {
    name: string;
    color: StageColor;
    kind: StageKind;
    marksApplied: boolean;
  }) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<StageKind>('active');
  const [marksApplied, setMarksApplied] = useState(true);

  return (
    <form
      className="border-line mt-5 flex flex-wrap items-end gap-2 border-t pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        const color: StageColor = kind === 'won' ? 'emerald' : kind === 'lost' ? 'rose' : 'sky';
        void onAdd({ name, color, kind, marksApplied }).then((ok) => {
          if (ok) setName('');
        });
      }}
    >
      <label className="flex min-w-40 flex-1 flex-col gap-1">
        <span className="text-muted text-xs font-medium">New column</span>
        <Input
          value={name}
          maxLength={MAX_STAGE_NAME}
          placeholder="e.g. Take-home task"
          onChange={(e) => setName(e.target.value)}
          className="h-8"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted text-xs font-medium">Type</span>
        <Select
          value={kind}
          onChange={(e) => setKind(e.target.value as StageKind)}
          className="h-8 w-auto text-[13px]"
        >
          {(Object.keys(KIND_LABEL) as StageKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </Select>
      </label>
      {kind === 'active' ? (
        <label className="text-muted flex h-8 items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={marksApplied}
            onChange={(e) => setMarksApplied(e.target.checked)}
            className="accent-accent"
          />
          Counts as applied
        </label>
      ) : null}
      <Button type="submit" size="sm" variant="secondary" icon={<Plus className="size-4" />}>
        Add column
      </Button>
    </form>
  );
}
