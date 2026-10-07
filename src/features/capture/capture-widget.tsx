import {
  AlertCircle,
  Bug,
  Check,
  EyeOff,
  Globe,
  LayoutGrid,
  MapPin,
  MoreHorizontal,
  PenLine,
  ScanSearch,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Job } from '@/domain/job';
import { findStage, captureStages, type Stage, type StageId } from '@/domain/stage';
import { formatSalary, type ExtractionResult } from '@/extraction';
import { getWidgetTab, openBoard, type ActiveTab } from '@/platform/tabs';
import { DuplicateJobError, JobLimitError } from '@/services/job-service';
import { Button, IconButton, Spinner } from '@/ui/components/button';
import { CompanyAvatar } from '@/ui/components/company-avatar';
import { Menu, type MenuEntry } from '@/ui/components/menu';
import { Logo } from '@/ui/components/misc';
import { WORKPLACE_LABEL } from '@/ui/format';
import { useServices, useSettings } from '@/ui/hooks/services';
import { STAGE_STYLE } from '@/ui/stage-style';
import { draftFromResult, emptyDraft, postingFromDraft, type Draft } from './capture-draft';
import { CaptureForm } from './capture-form';
import { DebugPanel } from './debug-panel';
import { closeWidget, reportHeight } from './widget-frame';
import { showsLauncher, WIDGET_ALL_SITES_KEY, WIDGET_HIDDEN_SITES_KEY } from './widget-protocol';
import { setAllSites } from '@/platform/all-sites';
import { AutofillBar } from '@/features/autofill/autofill-bar';
import { ReportDialog } from '@/features/feedback/report-dialog';
import { useAccount } from '@/ui/hooks/account';

/** Fields below this confidence are shown for checking, not saved at a glance. */
const LOW_CONFIDENCE = 0.6;

type State =
  | { kind: 'loading' }
  | { kind: 'failed'; message: string; tab: ActiveTab | undefined }
  | { kind: 'manual'; tab: ActiveTab | undefined }
  | { kind: 'ready'; result: ExtractionResult; tab: ActiveTab }
  /** On the board: found there, or just saved. */
  | { kind: 'tracked'; job: Job; tab: ActiveTab | undefined; justSaved: boolean };

/**
 * The floating widget (ADR-0030): the job you're looking at and what to do
 * next, in as few clicks as possible. Save it, fill the application, move
 * it to Applied, all without leaving the page. Runs in an iframe on the
 * page (or a tab in tests); see entrypoints/launcher.content.ts.
 */
export function CaptureWidget() {
  const services = useServices();
  const settings = useSettings();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [debug, setDebug] = useState(false);
  const [error, setError] = useState<string>();
  const [limited, setLimited] = useState<JobLimitError>();
  const [reporting, setReporting] = useState(false);
  const { state: accountState } = useAccount();
  const root = useRef<HTMLDivElement>(null);
  const [allSites, setAllSitesOn] = useState(false);
  useEffect(() => {
    void services.store
      .get([WIDGET_ALL_SITES_KEY])
      .then((stored) => setAllSitesOn(stored[WIDGET_ALL_SITES_KEY] === true));
  }, [services.store]);
  const started = useRef(false);

  useEffect(() => (root.current ? reportHeight(root.current) : undefined), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement).closest('dialog[open]')) closeWidget();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const capture = useCallback(async () => {
    await services.ready;
    const tab = await getWidgetTab();
    if (!tab) {
      setState({ kind: 'failed', message: 'No page to read.', tab: undefined });
      return;
    }
    const outcome = await services.capture.capture(tab.id, tab.url);
    if (!outcome.ok) {
      setState({ kind: 'failed', message: outcome.message, tab });
      return;
    }
    const { result } = outcome;
    const existing = await services.jobService.findDuplicate(
      result.url,
      result.site.id,
      result.fields.externalId,
    );
    if (existing) {
      setState({ kind: 'tracked', job: existing, tab, justSaved: false });
      return;
    }
    // Missing or doubtful basics: open the form instead of a one-click save.
    const shaky = (['title', 'company'] as const).some(
      (f) => (result.provenance[f]?.confidence ?? 0) < LOW_CONFIDENCE,
    );
    setEditing(shaky);
    setState({ kind: 'ready', result, tab });
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
      const tab = state.kind === 'ready' || state.kind === 'manual' ? state.tab : undefined;
      if (state.kind === 'ready') {
        job = await services.jobService.createFromExtraction(state.result, {
          overrides: postingFromDraft(draft, state.result),
          stageId: draft.stageId,
          priority: draft.priority,
          notes: draft.notes,
        });
      } else {
        const url = tab?.url?.startsWith('http') ? tab.url : undefined;
        job = await services.jobService.createManual({
          posting: postingFromDraft(draft),
          ...(url ? { url } : {}),
          stageId: draft.stageId,
        });
        if (draft.priority || draft.notes)
          job = await services.jobService.update(job.id, {
            priority: draft.priority,
            notes: draft.notes,
          });
      }
      setState({ kind: 'tracked', job, tab, justSaved: true });
    } catch (e) {
      if (e instanceof DuplicateJobError)
        setState({
          kind: 'tracked',
          job: e.existing,
          tab: 'tab' in state ? state.tab : undefined,
          justSaved: false,
        });
      else if (e instanceof JobLimitError) setLimited(e);
      else setError(e instanceof Error ? e.message : 'Could not save this job.');
    } finally {
      setSaving(false);
    }
  }

  async function moveTo(job: Job, stageId: StageId) {
    if (stageId === job.stageId) return;
    const [moved] = await services.jobService.moveMany([job.id], stageId);
    if (moved && state.kind === 'tracked') setState({ ...state, job: moved, justSaved: false });
  }

  const tab = 'tab' in state ? state.tab : undefined;
  const host = tab?.url ? safeHost(tab.url) : undefined;
  const menu: MenuEntry[] = [
    {
      label: 'Open board',
      icon: <LayoutGrid className="size-4" />,
      onSelect: () => void openBoard(),
    },
    ...(state.kind === 'ready' || state.kind === 'tracked'
      ? [
          {
            label: debug ? 'Hide extraction details' : 'Extraction details',
            icon: <ScanSearch className="size-4" />,
            onSelect: () => setDebug((d) => !d),
          },
        ]
      : []),
    {
      label: 'Report a problem…',
      icon: <Bug className="size-4" />,
      onSelect: () => setReporting(true),
    },
    'separator',
    {
      label: 'Show the button on all sites',
      icon: <Globe className="size-4" />,
      checked: allSites,
      // Chrome asks the user (ADR-0033); if it can't from here, the board can.
      onSelect: () =>
        void setAllSites(!allSites)
          .then(setAllSitesOn)
          .catch(() => openBoard()),
    },
    ...(host && tab?.url && showsLauncher(tab.url, allSites)
      ? [
          {
            label: `Hide the button on ${host}`,
            icon: <EyeOff className="size-4" />,
            onSelect: () => void hideOn(host),
          },
        ]
      : []),
  ];

  async function hideOn(site: string) {
    const stored = await services.store.get([WIDGET_HIDDEN_SITES_KEY]);
    const list = Array.isArray(stored[WIDGET_HIDDEN_SITES_KEY])
      ? (stored[WIDGET_HIDDEN_SITES_KEY] as string[])
      : [];
    await services.store.set({ [WIDGET_HIDDEN_SITES_KEY]: [...new Set([...list, site])] });
    closeWidget();
  }

  const result = state.kind === 'ready' ? state.result : undefined;
  return (
    <div ref={root} className="bg-canvas text-ink flex w-full flex-col">
      <header className="bg-surface border-line sticky top-0 z-10 flex h-11 shrink-0 items-center gap-1 border-b pr-1.5 pl-3">
        <Logo />
        <div className="flex-1" />
        <IconButton size="sm" label="Open board" onClick={() => void openBoard()}>
          <LayoutGrid className="size-4" />
        </IconButton>
        <Menu
          trigger={(props) => (
            <IconButton size="sm" label="More" {...props}>
              <MoreHorizontal className="size-4" />
            </IconButton>
          )}
          items={menu}
        />
        <IconButton size="sm" label="Close" onClick={closeWidget}>
          <X className="size-4" />
        </IconButton>
      </header>

      <main className="flex flex-col gap-3 p-3.5">
        {limited ? (
          <div
            role="alert"
            className="bg-accent-soft text-accent-ink flex flex-col gap-2 rounded-xl p-3 text-sm"
          >
            <p>
              <strong>Your free plan is full.</strong> You have {limited.check.active} of{' '}
              {limited.check.limit} active jobs. Move finished ones to Rejected, or upgrade to Pro
              for unlimited jobs.
            </p>
            <Button size="sm" variant="primary" onClick={() => void openBoard({ account: true })}>
              See Pro
            </Button>
          </div>
        ) : null}

        {state.kind === 'loading' ? <Loading /> : null}

        {state.kind === 'failed' ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <div className="flex size-9 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-500/15">
              <AlertCircle className="size-5 text-amber-600 dark:text-amber-400" />
            </div>
            <p className="text-muted max-w-[280px] text-sm">{state.message}</p>
            <Button
              size="sm"
              icon={<PenLine className="size-4" />}
              onClick={() => setState({ kind: 'manual', tab: state.tab })}
            >
              Add it yourself
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

        {result ? (
          editing ? (
            <CaptureForm
              initial={draftFromResult(result, settings.defaultStageId)}
              stages={settings.stages}
              provenance={result.provenance}
              onSubmit={save}
              submitting={saving}
              error={error}
            />
          ) : (
            <QuickSave
              result={result}
              stages={settings.stages}
              defaultStageId={settings.defaultStageId}
              saving={saving}
              error={error}
              onEdit={() => setEditing(true)}
              onSave={(stageId) =>
                void save({ ...draftFromResult(result, settings.defaultStageId), stageId })
              }
            />
          )
        ) : null}

        {state.kind === 'tracked' ? (
          <Tracked
            job={state.job}
            stages={settings.stages}
            justSaved={state.justSaved}
            onMove={(stageId) => void moveTo(state.job, stageId)}
          />
        ) : null}

        {state.kind !== 'loading' ? <AutofillBar tabId={tab?.id} /> : null}

        {debug && result && tab ? <DebugPanel result={result} tabId={tab.id} /> : null}
      </main>
      <ReportDialog
        open={reporting}
        onClose={() => setReporting(false)}
        feedback={services.feedback}
        where="widget"
        {...(accountState?.email ? { email: accountState.email } : {})}
        {...(tab?.url?.startsWith('http') ? { page: tab.url } : {})}
      />
    </div>
  );
}

function safeHost(href: string): string | undefined {
  try {
    const url = new URL(href);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.hostname : undefined;
  } catch {
    return undefined;
  }
}

function Loading() {
  return (
    <div className="flex flex-col gap-3" aria-busy>
      <div className="text-muted flex items-center gap-2 text-sm">
        <Spinner className="text-accent" /> Reading this job…
      </div>
      {[70, 45].map((w, i) => (
        <div
          key={i}
          className="bg-surface-3 h-8 animate-pulse rounded-lg"
          style={{ width: `${w + 30}%` }}
        />
      ))}
    </div>
  );
}

/** What was found, at a glance, and Save. "Edit details" opens the full form. */
function QuickSave({
  result,
  stages,
  defaultStageId,
  saving,
  error,
  onEdit,
  onSave,
}: {
  result: ExtractionResult;
  stages: readonly Stage[];
  defaultStageId: StageId;
  saving: boolean;
  error: string | undefined;
  onEdit: () => void;
  onSave: (stageId: StageId) => void;
}) {
  const [stageId, setStageId] = useState(defaultStageId);
  const f = result.fields;
  const doubtful = (['location', 'salary', 'workplaceType'] as const).some(
    (k) => f[k] !== undefined && (result.provenance[k]?.confidence ?? 0) < LOW_CONFIDENCE,
  );
  const facts = [
    f.location,
    f.workplaceType ? WORKPLACE_LABEL[f.workplaceType] : undefined,
    formatSalary(f.salary),
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <CompanyAvatar company={f.company ?? result.site.name} />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[15px] leading-snug font-semibold">{f.title}</p>
          <p className="text-muted truncate text-sm">
            {f.company}
            {result.site.id !== 'generic' ? ` · ${result.site.name}` : ''}
          </p>
          {facts.length ? (
            <p className="text-muted mt-1 flex items-start gap-1 text-[13px]">
              <MapPin className="mt-0.5 size-3.5 shrink-0" />
              <span>{facts.join(' · ')}</span>
            </p>
          ) : null}
        </div>
      </div>
      {doubtful ? (
        <p className="text-[13px] text-amber-700 dark:text-amber-400">
          Some details are a best guess.{' '}
          <button type="button" className="font-medium underline" onClick={onEdit}>
            Check them
          </button>
        </p>
      ) : null}
      <StagePicker stages={stages} value={stageId} onChange={setStageId} />
      <div className="flex gap-2">
        <Button
          className="flex-1 justify-center"
          variant="primary"
          loading={saving}
          onClick={() => onSave(stageId)}
        >
          Save job
        </Button>
        <Button variant="ghost" icon={<PenLine className="size-4" />} onClick={onEdit}>
          Edit details
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Already on the board: where it is, one tap to move it on, and the card. */
function Tracked({
  job,
  stages,
  justSaved,
  onMove,
}: {
  job: Job;
  stages: readonly Stage[];
  justSaved: boolean;
  onMove: (stageId: StageId) => void;
}) {
  const stage = findStage(stages, job.stageId);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        {justSaved ? (
          <div className="animate-pop flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
            <Check className="size-5" strokeWidth={3} />
          </div>
        ) : (
          <CompanyAvatar company={job.company || job.title} />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400" role="status">
            {justSaved ? 'Saved' : 'On your board'}
            {stage ? ` · ${stage.name}` : ''}
          </p>
          <p className="line-clamp-2 text-[15px] leading-snug font-semibold">{job.title}</p>
          {job.company ? <p className="text-muted truncate text-sm">{job.company}</p> : null}
        </div>
      </div>
      <StagePicker stages={stages} value={job.stageId} onChange={onMove} label="Move to" />
      <Button
        variant="secondary"
        icon={<LayoutGrid className="size-4" />}
        onClick={() => void openBoard(job.id)}
      >
        Open card
      </Button>
    </div>
  );
}

/** The board's columns as one row of chips. */
function StagePicker({
  stages,
  value,
  onChange,
  label = 'Column',
}: {
  stages: readonly Stage[];
  value: StageId;
  onChange: (stageId: StageId) => void;
  label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {captureStages(stages).map((stage) => {
        const on = stage.id === value;
        return (
          <button
            key={stage.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(stage.id)}
            className={
              on
                ? `flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-current ${STAGE_STYLE[stage.color].chip}`
                : 'text-muted border-line hover:bg-surface-2 flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs'
            }
          >
            <span className={`size-1.5 rounded-full ${STAGE_STYLE[stage.color].dot}`} />
            {stage.name}
          </button>
        );
      })}
    </div>
  );
}
