import clsx from 'clsx';
import { AlertCircle, CalendarCheck, Check, Columns3, LayoutGrid, Plus } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { browser } from 'wxt/browser';
import type { Job } from '@/domain/job';
import { AutofillBar } from '@/features/autofill/autofill-bar';
import { getActiveTab, openBoard } from '@/platform/tabs';
import { DuplicateJobError, JobLimitError } from '@/services/job-service';
import { limitMessage } from '@/features/account/plan-copy';
import { Button } from '@/ui/components/button';
import { Logo } from '@/ui/components/misc';
import { useAccount } from '@/ui/hooks/account';
import { useAutoEmailUpdates } from '@/ui/hooks/email';
import { useApplyTheme, useLiveJobs, useServices } from '@/ui/hooks/services';
import { useAutoSync } from '@/ui/hooks/sync';
import { BoardView } from '@/web/board-view';
import { JobSheet } from '@/web/job-sheet';
import { TodayView } from '@/web/today-view';

/**
 * Rolestash docked beside the page (ADR-0021). On every plan: save the page
 * you're on and open the board. On Advanced: Today, the board and a job's
 * details, using the web board's phone-sized views, plus autofill.
 */
export function SidePanel() {
  useApplyTheme();
  const { account, state } = useAccount();
  // A build without accounts isn't limited, like every plan gate.
  const plan = account ? state?.plan.plan : undefined;
  const full = !account || plan === 'advanced';
  useAutoSync();
  useAutoEmailUpdates(plan);
  const { tabId, page } = useActivePage();
  const [view, setView] = useState<'today' | 'board'>('today');
  const [openId, setOpenId] = useState<string>();
  const [stage, setStage] = useState<string>();

  return (
    <div className="bg-canvas text-ink flex min-h-dvh flex-col">
      <header className="bg-canvas/90 border-line sticky top-0 z-10 flex h-12 items-center justify-between border-b px-3 backdrop-blur">
        <Logo />
        <Button
          size="sm"
          variant="ghost"
          icon={<LayoutGrid className="size-4" />}
          onClick={() => void openBoard()}
        >
          Open board
        </Button>
      </header>

      <main className="flex flex-1 flex-col gap-3 p-3">
        {/* Remounted per page, so it starts fresh after you switch tab or navigate. */}
        <ThisPage key={page} tabId={tabId} onOpen={setOpenId} />
        {full ? <AutofillBar tabId={tabId} /> : null}

        {full ? (
          <>
            <nav
              aria-label="Panel views"
              className="bg-surface-2 grid grid-cols-2 gap-1 rounded-lg p-1"
            >
              <ViewTab
                active={view === 'today'}
                onClick={() => setView('today')}
                icon={<CalendarCheck className="size-4" />}
              >
                Today
              </ViewTab>
              <ViewTab
                active={view === 'board'}
                onClick={() => setView('board')}
                icon={<Columns3 className="size-4" />}
              >
                Board
              </ViewTab>
            </nav>
            {view === 'today' ? (
              <TodayView
                onOpen={setOpenId}
                onShowStage={(id) => {
                  setStage(id);
                  setView('board');
                }}
              />
            ) : (
              <BoardView onOpen={setOpenId} stage={stage} onStage={setStage} />
            )}
            <JobSheet id={openId} onClose={() => setOpenId(undefined)} />
          </>
        ) : plan ? (
          <section className="border-line bg-surface rounded-xl border p-4 text-sm">
            <p className="font-semibold">Your whole board, right here</p>
            <p className="text-muted mt-1">
              With Advanced, this panel shows what’s due today and your board, lets you move jobs
              and set follow-ups without leaving the page, and fills applications for you.
            </p>
            <Button className="mt-3" size="sm" onClick={() => void openBoard({ account: true })}>
              See plans
            </Button>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function ViewTab({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={clsx(
        'flex h-8 items-center justify-center gap-1.5 rounded-md text-sm font-medium',
        active ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/**
 * The active tab in this window, and a key that changes whenever you switch
 * tab or the page in it finishes loading.
 */
function useActivePage(): { tabId: number | undefined; page: string } {
  const [tabId, setTabId] = useState<number>();
  const [loads, setLoads] = useState(0);
  useEffect(() => {
    const load = () => void getActiveTab().then((tab) => setTabId(tab?.id));
    load();
    const onActivated = () => load();
    const onUpdated = (_id: number, info: { status?: string }) => {
      if (info.status !== 'complete') return;
      setLoads((n) => n + 1);
      load();
    };
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    return () => {
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);
  return { tabId, page: `${String(tabId)}-${String(loads)}` };
}

type PageState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; job: Job }
  | { kind: 'duplicate'; job: Job }
  | { kind: 'failed'; message: string };

/** "Save this page": the popup's one-click save, without leaving the page. */
function ThisPage({ tabId, onOpen }: { tabId: number | undefined; onOpen: (id: string) => void }) {
  const services = useServices();
  const live = useLiveJobs();
  const [state, setState] = useState<PageState>({ kind: 'idle' });

  async function save() {
    const tab = await getActiveTab();
    if (!tab) return;
    setState({ kind: 'saving' });
    const outcome = await services.capture.capture(tab.id, tab.url);
    if (!outcome.ok) {
      setState({
        kind: 'failed',
        message:
          outcome.reason === 'restricted'
            ? 'To save this page, click the Rolestash icon (or press Alt+J) while you’re on it, then try again.'
            : outcome.message,
      });
      return;
    }
    if (!outcome.result.isJobPage) {
      setState({ kind: 'failed', message: 'This doesn’t look like a job posting.' });
      return;
    }
    try {
      const job = await services.jobService.createFromExtraction(outcome.result);
      live.applyLocal([job]);
      setState({ kind: 'saved', job });
    } catch (error) {
      if (error instanceof DuplicateJobError) setState({ kind: 'duplicate', job: error.existing });
      else
        setState({
          kind: 'failed',
          message: error instanceof JobLimitError ? limitMessage(error) : 'Couldn’t save this job.',
        });
    }
  }

  return (
    <section
      aria-label="This page"
      className="border-line bg-surface rounded-xl border p-3 text-sm"
    >
      {state.kind === 'saved' || state.kind === 'duplicate' ? (
        <div className="flex items-center justify-between gap-2">
          <p className="flex min-w-0 items-center gap-1.5">
            <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span className="truncate">
              {state.kind === 'saved' ? 'Saved: ' : 'Already on your board: '}
              <b className="font-medium">{state.job.title}</b>
            </span>
          </p>
          <Button size="sm" onClick={() => onOpen(state.job.id)}>
            View
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted">Looking at a job?</span>
          <Button
            size="sm"
            variant="primary"
            icon={<Plus className="size-3.5" />}
            loading={state.kind === 'saving'}
            disabled={tabId === undefined}
            onClick={() => void save()}
          >
            Save this page
          </Button>
        </div>
      )}
      {state.kind === 'failed' ? (
        <p className="text-muted mt-2 flex items-start gap-1.5 text-[13px]">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
          {state.message}
        </p>
      ) : null}
    </section>
  );
}
