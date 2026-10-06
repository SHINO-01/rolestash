import clsx from 'clsx';
import { useState, type SyntheticEvent } from 'react';
import { WORKPLACE_TYPES, type WorkplaceType } from '@/domain/job';
import { laneStages, type Stage } from '@/domain/stage';
import type { Draft } from './capture-draft';
import type { ExtractionResult, FieldKey } from '@/extraction';
import { Button } from '@/ui/components/button';
import { Field, Input, Select, Textarea } from '@/ui/components/field';
import { PriorityInput } from '@/ui/components/misc';
import { WORKPLACE_LABEL } from '@/ui/format';
import { STAGE_STYLE } from '@/ui/stage-style';

const LOW_CONFIDENCE = 0.6;

export function CaptureForm({
  initial,
  stages,
  provenance,
  onSubmit,
  submitting,
  error,
}: {
  initial: Draft;
  stages: readonly Stage[];
  provenance?: ExtractionResult['provenance'];
  onSubmit: (draft: Draft) => void | Promise<void>;
  submitting: boolean;
  error?: string | undefined;
}) {
  const [draft, setDraft] = useState(initial);
  const [showNotes, setShowNotes] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const uncertain = (field: FieldKey) =>
    provenance !== undefined && (provenance[field]?.confidence ?? 0) < LOW_CONFIDENCE;
  const hint = (field: FieldKey, value: string) =>
    provenance && value && uncertain(field) ? (
      <span className="text-amber-700 dark:text-amber-400">Best guess — please check</span>
    ) : undefined;

  const stage = stages.find((s) => s.id === draft.stageId);

  function submit(e: SyntheticEvent) {
    e.preventDefault();
    void onSubmit(draft);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5">
      <Field label="Job title" hint={hint('title', draft.title)}>
        {(id) => (
          <Input
            id={id}
            required
            autoFocus
            value={draft.title}
            warn={Boolean(provenance && draft.title && uncertain('title'))}
            onChange={(e) => set('title', e.target.value)}
            placeholder="e.g. Senior Software Engineer"
          />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Company" hint={hint('company', draft.company)}>
          {(id) => (
            <Input
              id={id}
              value={draft.company}
              warn={Boolean(provenance && draft.company && uncertain('company'))}
              onChange={(e) => set('company', e.target.value)}
              placeholder="Company"
            />
          )}
        </Field>
        <Field label="Location">
          {(id) => (
            <Input
              id={id}
              value={draft.location}
              onChange={(e) => set('location', e.target.value)}
              placeholder="City"
            />
          )}
        </Field>
        <Field label="Workplace">
          {(id) => (
            <Select
              id={id}
              value={draft.workplaceType}
              onChange={(e) => set('workplaceType', e.target.value as WorkplaceType | '')}
            >
              <option value="">Not specified</option>
              {WORKPLACE_TYPES.map((w) => (
                <option key={w} value={w}>
                  {WORKPLACE_LABEL[w]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Salary">
          {(id) => (
            <Input
              id={id}
              value={draft.salaryText}
              onChange={(e) => set('salaryText', e.target.value)}
              placeholder="e.g. $120k – 140k"
            />
          )}
        </Field>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-muted text-xs font-medium">Column</span>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Column">
          {laneStages(stages).map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={draft.stageId === s.id}
              onClick={() => set('stageId', s.id)}
              className={clsx(
                'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors',
                draft.stageId === s.id
                  ? 'border-accent bg-accent-soft text-accent-ink'
                  : 'text-muted hover:border-line-strong border-line bg-surface',
              )}
            >
              <span className={clsx('size-1.5 rounded-full', STAGE_STYLE[s.color].dot)} />
              {s.name}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <PriorityInput value={draft.priority} onChange={(p) => set('priority', p)} />
        {!showNotes ? (
          <button
            type="button"
            className="text-accent text-xs font-medium hover:underline"
            onClick={() => setShowNotes(true)}
          >
            + Add a note
          </button>
        ) : null}
      </div>
      {showNotes ? (
        <Textarea
          aria-label="Notes"
          autoFocus
          className="min-h-16"
          value={draft.notes}
          onChange={(e) => set('notes', e.target.value)}
          placeholder="Referral, recruiter name, why you’re excited…"
        />
      ) : null}

      {error ? <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}

      <Button type="submit" variant="primary" loading={submitting} className="w-full">
        Save to {stage?.name ?? 'board'}
      </Button>
    </form>
  );
}
