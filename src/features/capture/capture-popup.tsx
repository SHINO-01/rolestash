import { AlertCircle, Check, LayoutGrid, PanelRight, PenLine } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Job } from '@/domain/job';
import { findStage, type Stage } from '@/domain/stage';
import type { ExtractionResult } from '@/extraction';
import { openSidePanel } from '@/platform/side-panel';
import { getActiveTab, openBoard, type ActiveTab } from '@/platform/tabs';
import { DuplicateJobError, JobLimitError } from '@/services/job-service';
import { Button, IconButton, Spinner } from '@/ui/components/button';
import { CompanyAvatar } from '@/ui/components/company-avatar';
import { Logo } from '@/ui/components/misc';
import { useServices, useSettings } from '@/ui/hooks/services';
import { STAGE_STYLE } from '@/ui/stage-style';
import { draftFromResult, emptyDraft, postingFromDraft, type Draft } from './capture-draft';
import { CaptureForm } from './capture-form';
import { DebugPanel } from './debug-panel';
import { AutofillBar } from '@/features/autofill/autofill-bar';

type State =
  | { kind: 'loading' }
  | { kind: 'failed'; message: string; tab: ActiveTab | undefined }
  | { kind: 'manual'; tab: ActiveTab | undefined }
  | { kind: 'ready'; result: ExtractionResult; tab: ActiveTab; duplicate: Job | undefined }
  | { kind: 'saved'; job: Job };

export function CapturePopup() {
  const services = useServices();
  const settings = useSettings();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [limited, setLimited] = useState<JobLimitError>();
  const started = useRef(false);

  const capture = useCallback(async () => {
    await services.ready;
    const tab = await getActiveTab();
    if (!tab) {
      setState({ kind: 'failed', message: 'No active tab found.', tab: undefined });
      return;
    }
    const outcome = await services.capture.capture(tab.id, tab.url);
    if (!outcome.ok) {
      setState({ kind: 'failed', message: outcome.message, tab });
      return;
    }
    const { result } = outcome;
    const duplicate = await services.jobService.findDuplicate(
      result.url,
      result.site.id,
      result.fields.externalId,
    );
    setState({ kind: 'ready', result, tab, duplicate });
  }, [services]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void capture();
  }, [capture]);

  async function save(draft: Draft) {
    setSaving(true);
    setError(undefined);
    try {
      let job: Job;
      if (state.kind === 'ready') {
        job = await services.jobService.createFromExtraction(state.result, {
          overrides: postingFromDraft(draft, state.result),
          stageId: draft.stageId,
          priority: draft.priority,
          notes: draft.notes,
        });
      } else {
        const url =
          state.kind === 'manual' && state.tab?.url?.startsWith('http') ? state.tab.url : undefined;
        job = await services.jobService.createManual({
          posting: postingFromDraft(draft),
          ...(url ? { url } : {}),
          stageId: draft.stageId,
        });
        if (draft.priority || draft.notes) {
          job = await services.jobService.update(job.id, {
            priority: draft.priority,
            notes: draft.notes,
          });
        }
      }
      setState({ kind: 'saved', job });
    } catch (e) {
      if (e instanceof DuplicateJobError && state.kind === 'ready') {
        setState({ ...state, duplicate: e.existing });
      } else if (e instanceof JobLimitError) {
        setLimited(e);
      } else {
        setError(e instanceof Error ? e.message : 'Could not save this job.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-canvas flex max-h-[600px] w-[380px] flex-col">
      <header className="bg-surface border-line flex h-12 shrink-0 items-center justify-between border-b px-4">
        <Logo />
        <div className="flex items-center gap-1">
          <IconButton
            size="sm"
            label="Open side panel"
            onClick={() => void openSidePanel().then(() => window.close())}
          >
            <PanelRight className="size-4" />
          </IconButton>
          <Button
            variant="ghost"
            size="sm"
            icon={<LayoutGrid className="size-4" />}
            onClick={() => void openBoard()}
          >
            Open board
          </Button>
        </div>
      </header>

      <main className="flex-1 scrollbar-thin overflow-y-auto p-4">
        {state.kind !== 'loading' && state.kind !== 'saved' ? (
          <AutofillBar tabId={state.tab?.id} />
        ) : null}
        {limited ? (
          <div
            role="alert"
            className="bg-accent-soft text-accent-ink mb-3 flex flex-col gap-2 rounded-xl p-3 text-sm"
          >
            <p>
              <strong>Plan limit reached.</strong> You have {limited.check.active} of{' '}
              {limited.check.limit} active jobs. Move finished ones to Rejected or Withdrawn, or
              open Account for a bigger plan.
            </p>
            <Button
              size="sm"
              variant="primary"
              onClick={() => void openBoard({ account: true }).then(() => window.close())}
            >
              Open account
            </Button>
          </div>
        ) : null}
        {state.kind === 'loading' ? <Loading /> : null}

        {state.kind === 'failed' ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-500/15">
              <AlertCircle className="size-5 text-amber-600 dark:text-amber-400" />
            </div>
            <p className="text-muted max-w-[280px] text-sm">{state.message}</p>
            <Button
              icon={<PenLine className="size-4" />}
              onClick={() => setState({ kind: 'manual', tab: state.tab })}
            >
              Add a job manually
            </Button>
          </div>
        ) : null}

        {state.kind === 'manual' ? (
          <CaptureForm
            initial={emptyDraft(settings.defaultStageId, state.tab?.title)}
            stages={settings.stages}
            onSubmit={save}
            submitting={saving}
            error={error}
          />
        ) : null}

        {state.kind === 'ready' ? (
          <div className="flex flex-col gap-4">
            <SourceSummary result={state.result} />
            {state.duplicate ? (
              <DuplicateNotice job={state.duplicate} stages={settings.stages} />
            ) : (
              <CaptureForm
                initial={draftFromResult(state.result, settings.defaultStageId)}
                stages={settings.stages}
                provenance={state.result.provenance}
                onSubmit={save}
                submitting={saving}
                error={error}
              />
            )}
            <DebugPanel result={state.result} tabId={state.tab.id} />
          </div>
        ) : null}

        {state.kind === 'saved' ? <Saved job={state.job} stages={settings.stages} /> : null}
      </main>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy>
      <div className="text-muted flex items-center gap-2 text-sm">
        <Spinner className="text-accent" /> Reading this page…
      </div>
      {[70, 45, 55, 35].map((w, i) => (
        <div
          key={i}
          className="bg-surface-3 h-9 animate-pulse rounded-lg"
          style={{ width: `${w + 30}%` }}
        />
      ))}
    </div>
  );
}

function SourceSummary({ result }: { result: ExtractionResult }) {
  const titleStrategy = result.provenance.title?.strategy;
  const structured = titleStrategy === 'json-ld' || titleStrategy === 'microdata';
  const label = structured
    ? 'Structured data'
    : result.site.id !== 'generic'
      ? 'Site adapter'
      : 'Best guess';
  const tone = structured
    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
    : result.site.id !== 'generic'
      ? 'bg-accent-soft text-accent-ink'
      : 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300';
  return (
    <div className="flex items-center gap-3">
      <CompanyAvatar company={result.fields.company ?? result.site.name} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{result.site.name}</p>
        <p className="text-subtle truncate text-xs">{new URL(result.url).pathname}</p>
      </div>
      <span className={`rounded-md px-1.5 py-1 text-[11px] leading-none font-medium ${tone}`}>
        {label}
      </span>
    </div>
  );
}

function DuplicateNotice({ job, stages }: { job: Job; stages: readonly Stage[] }) {
  const stage = findStage(stages, job.stageId);
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 dark:border-amber-500/30 dark:bg-amber-500/10">
      <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
        Already on your board
      </p>
      <p className="mt-0.5 text-sm text-amber-800/80 dark:text-amber-200/70">
        {job.title}
        {stage ? ` · ${stage.name}` : ''}
      </p>
      <Button
        size="sm"
        className="mt-3"
        onClick={() => void openBoard(job.id).then(() => window.close())}
      >
        Open card
      </Button>
    </div>
  );
}

function Saved({ job, stages }: { job: Job; stages: readonly Stage[] }) {
  const stage = findStage(stages, job.stageId);
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <div className="animate-pop flex size-12 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/30">
        <Check className="size-6" strokeWidth={3} />
      </div>
      <p className="mt-2 text-base font-semibold">
        Saved to{' '}
        {stage ? (
          <span className={`rounded-md px-1.5 py-0.5 ${STAGE_STYLE[stage.color].chip}`}>
            {stage.name}
          </span>
        ) : (
          'your board'
        )}
      </p>
      <p className="text-muted line-clamp-2 max-w-[300px] text-sm">
        {job.title}
        {job.company ? ` · ${job.company}` : ''}
      </p>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" onClick={() => window.close()}>
          Done
        </Button>
        <Button variant="primary" onClick={() => void openBoard(job.id).then(() => window.close())}>
          View on board
        </Button>
      </div>
    </div>
  );
}
