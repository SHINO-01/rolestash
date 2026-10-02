import {
  BarChart3,
  Download,
  BellRing,
  CalendarDays,
  Columns3,
  History,
  FileSpreadsheet,
  ListChecks,
  Inbox,
  Keyboard,
  Monitor,
  Moon,
  MoreHorizontal,
  PanelRight,
  Plus,
  Search,
  Sun,
  Upload,
  UserRound,
  Wand2,
} from 'lucide-react';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { boardEvents, calendarFile } from '@/domain/calendar';
import { boardView, historyStart } from '@/domain/history';
import type { Theme } from '@/domain/settings';
import { createBackup } from '@/storage/backup';
import { jobsToCsv } from '@/storage/csv-export';
import { requestNotifications } from '@/platform/notifications';
import { setIconOpensPanel } from '@/platform/side-panel';
import { PinTip } from './pin-tip';
import { AccountDialog } from '@/features/account/account-dialog';
import { PlanBanner } from '@/features/account/plan-banner';
import { UnsortedDialog } from '@/features/email/unsorted-dialog';
import { ProfileDialog } from '@/features/autofill/profile-dialog';
import { allows } from '@/domain/plan';
import { InsightsDialog } from '@/features/insights/insights-dialog';
import { useAutoEmailUpdates, useEmailState } from '@/ui/hooks/email';
import { planChip } from '@/features/account/plan-copy';
import { Button, IconButton, Spinner } from '@/ui/components/button';
import { Menu } from '@/ui/components/menu';
import { Kbd, Logo } from '@/ui/components/misc';
import { UserAvatar } from '@/ui/components/user-avatar';
import { useToast } from '@/ui/components/toast';
import { useAccount } from '@/ui/hooks/account';
import { useAutoSync } from '@/ui/hooks/sync';
import { useJobs, useServices, useSettings } from '@/ui/hooks/services';
import { matchesQuery } from '@/ui/format';
import { AddJobDialog } from './add-job-dialog';
import { EmptyBoard } from './empty-board';
import { ColumnsDialog } from './columns-dialog';
import { HistoryDialog, HistoryLimitNote } from './history-dialog';
import { ImportDialog } from './import-dialog';
import { JobDrawer } from './job-drawer';
import { Kanban } from './kanban';
import { BoardStats } from './board-stats';
import { BulkBar } from './bulk-bar';
import { SelectionContext, type Selection } from './selection';

function readJobFromHash(): string | undefined {
  const m = /job=([^&]+)/.exec(location.hash);
  return m?.[1] ? decodeURIComponent(m[1]) : undefined;
}

export function BoardPage() {
  const services = useServices();
  const settings = useSettings();
  const { jobs, loaded } = useJobs();
  const toast = useToast();

  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [openJobId, setOpenJobId] = useState<string | undefined>(readJobFromHash);
  const { account, state: accountState } = useAccount();
  useAutoSync();
  const [dialog, setDialog] = useState<
    | 'add'
    | 'import'
    | 'account'
    | 'history'
    | 'columns'
    | 'unsorted'
    | 'profile'
    | 'insights'
    | null
  >(() =>
    location.hash === '#account' ? 'account' : location.hash === '#profile' ? 'profile' : null,
  );
  const searchRef = useRef<HTMLInputElement>(null);

  // History (ADR-0013): Free shows 30 days of finished and archived jobs.
  // Without accounts in the build, nothing is limited.
  const plan = account ? (accountState?.plan.plan ?? 'free') : undefined;
  const historyFrom = useMemo(() => historyStart(plan, new Date()), [plan]);

  // Email updates (Advanced; ADR-0014): apply new ones while the board is open.
  const emailState = useEmailState();
  const unsortedCount = emailState?.unsorted.length ?? 0;
  useAutoEmailUpdates(
    plan,
    useCallback(
      (run: { applied: number; suggested: number; unsorted: number }) => {
        const parts = [
          run.applied ? `${String(run.applied)} updated` : undefined,
          run.suggested ? `${String(run.suggested)} to review` : undefined,
          run.unsorted ? `${String(run.unsorted)} unsorted` : undefined,
        ].filter(Boolean);
        toast({
          message: `From your email: ${parts.join(', ')}`,
          ...(run.unsorted
            ? { action: { label: 'Sort', onClick: () => setDialog('unsorted') } }
            : {}),
        });
      },
      [toast],
    ),
  );
  const onBoard = useMemo(() => jobs.filter((j) => !j.archivedAt), [jobs]);
  const board = useMemo(
    () => boardView(jobs, settings.stages, historyFrom),
    [jobs, settings.stages, historyFrom],
  );
  const visibleJobs = useMemo(
    () => board.board.filter((j) => matchesQuery(j, deferredQuery)),
    [board, deferredQuery],
  );
  const openJob = openJobId ? jobs.find((j) => j.id === openJobId) : undefined;

  // Deep links (#job=<id>) from the popup and the "View on board" button.
  useEffect(() => {
    const onHash = () => {
      setOpenJobId(readJobFromHash());
      if (location.hash === '#account') setDialog('account');
      if (location.hash === '#profile') setDialog('profile');
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const openCard = useCallback((id: string | undefined) => {
    setOpenJobId(id);
    history.replaceState(null, '', id ? `#job=${encodeURIComponent(id)}` : location.pathname);
  }, []);

  // Keyboard: "/" focuses search, "n" adds a job.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable], dialog[open]')) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'n' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setDialog('add');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function download(contents: string, type: string, name: string, extension: string) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([contents], { type }));
    a.download = `${name}-${new Date().toISOString().slice(0, 10)}.${extension}`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function exportBackup() {
    const backup = await createBackup(services.jobs, services.settings);
    download(JSON.stringify(backup, null, 2), 'application/json', 'rolestash-backup', 'json');
    toast({ message: `Exported ${String(backup.jobs.length)} jobs`, tone: 'success' });
  }

  // Pro and up (or a build without accounts): contacts, rounds, documents, calendar export.
  const recordsAllowed = allows(plan, 'records');
  const bulkAllowed = allows(plan, 'bulk');

  // Bulk actions (Pro and up): select mode, or Ctrl/⌘-click a card.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setSelecting(false);
  }, []);
  const pitchSelect = useCallback(() => {
    toast({
      message: 'Selecting several jobs at once is part of Pro.',
      ...(account ? { action: { label: 'See plans', onClick: () => setDialog('account') } } : {}),
    });
  }, [toast, account]);
  const selection = useMemo<Selection>(
    () => ({
      active: selecting,
      selected,
      toggle: (id) => {
        if (!bulkAllowed) {
          pitchSelect();
          return;
        }
        setSelected((current) => {
          const next = new Set(current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      },
    }),
    [selecting, selected, bulkAllowed, pitchSelect],
  );
  // Selected cards that are still on the board (filtered or deleted ones drop out).
  const selectedIds = useMemo(
    () => onBoard.filter((j) => selected.has(j.id)).map((j) => j.id),
    [onBoard, selected],
  );
  useEffect(() => {
    if (!selecting && selected.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement).closest('dialog[open], input'))
        clearSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selecting, selected, clearSelection]);

  function exportCalendar() {
    const events = boardEvents(jobs);
    download(
      calendarFile(events, new Date()),
      'text/calendar;charset=utf-8',
      'rolestash-calendar',
      'ics',
    );
    toast({
      message: events.length
        ? `Exported ${String(events.length)} calendar ${events.length === 1 ? 'event' : 'events'}`
        : 'Nothing dated on the board yet',
      tone: 'success',
    });
  }

  async function exportCsv() {
    const all = await services.jobs.list();
    download(jobsToCsv(all, settings.stages), 'text/csv;charset=utf-8', 'rolestash-jobs', 'csv');
    toast({ message: `Exported ${String(all.length)} jobs to CSV`, tone: 'success' });
  }

  const setTheme = (theme: Theme) => void services.settings.update({ theme });

  // One-click access (ADR-0021): the toolbar icon opens the docked panel.
  async function toggleIconOpensPanel() {
    const on = settings.iconOpensPanel !== true;
    await services.settings.update({ iconOpensPanel: on });
    await setIconOpensPanel(on);
    toast({
      message: on
        ? 'Clicking the Rolestash icon now opens the side panel'
        : 'Clicking the Rolestash icon now opens the popup',
      tone: 'success',
    });
  }

  async function toggleClosingAlerts() {
    const on = settings.closingAlerts === false;
    if (on) await requestNotifications();
    await services.settings.update({ closingAlerts: on });
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-16 shrink-0 items-center gap-4 px-6">
        <Logo />
        <div className="relative ml-4 w-full max-w-sm min-w-48">
          <Search className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && (setQuery(''), searchRef.current?.blur())}
            placeholder="Search jobs, companies, tags…"
            aria-label="Search jobs"
            className="bg-surface text-ink placeholder:text-subtle focus:border-accent focus:ring-accent/15 border-line h-9 w-full rounded-lg border pr-9 pl-9 text-sm transition focus:ring-3 focus:outline-none"
          />
          <span className="absolute top-1/2 right-2.5 -translate-y-1/2">
            <Kbd>/</Kbd>
          </span>
        </div>
        <div className="flex-1" />
        <BoardStats jobs={onBoard} stages={settings.stages} />
        {unsortedCount > 0 ? (
          <Button
            variant="ghost"
            icon={<Inbox className="size-4" />}
            onClick={() => setDialog('unsorted')}
          >
            Unsorted ({unsortedCount})
          </Button>
        ) : null}
        <Button
          variant={selecting ? 'secondary' : 'ghost'}
          icon={<ListChecks className="size-4" />}
          aria-pressed={selecting}
          aria-label={selecting ? 'Done selecting' : 'Select'}
          title={selecting ? 'Done selecting' : 'Select several jobs'}
          onClick={() => {
            if (!bulkAllowed) {
              pitchSelect();
              return;
            }
            if (selecting) clearSelection();
            else setSelecting(true);
          }}
        >
          <span className="hidden 2xl:inline">{selecting ? 'Done' : 'Select'}</span>
        </Button>
        <Button
          variant="ghost"
          icon={<BarChart3 className="size-4" />}
          onClick={() => setDialog('insights')}
          aria-label="Insights"
          title="Insights"
        >
          <span className="hidden 2xl:inline">Insights</span>
        </Button>
        <Button
          variant="ghost"
          icon={<History className="size-4" />}
          onClick={() => setDialog('history')}
          aria-label="History"
          title="History"
        >
          <span className="hidden 2xl:inline">History</span>
        </Button>
        <Button
          variant="primary"
          icon={<Plus className="size-4" />}
          onClick={() => setDialog('add')}
        >
          Add job
        </Button>
        {account ? (
          <Button
            variant="ghost"
            icon={
              accountState?.signedIn ? (
                <UserAvatar
                  profile={accountState.profile}
                  name={accountState.firstName}
                  email={accountState.email}
                  size="sm"
                />
              ) : (
                <UserRound className="size-4" />
              )
            }
            onClick={() => setDialog('account')}
            aria-label="Account"
          >
            {accountState?.signedIn ? planChip(accountState.plan).label : 'Sign in'}
          </Button>
        ) : null}
        <Menu
          trigger={(props) => (
            <IconButton label="Board menu" {...props}>
              <MoreHorizontal className="size-5" />
            </IconButton>
          )}
          items={[
            {
              label: 'Edit columns…',
              icon: <Columns3 className="size-4" />,
              onSelect: () => setDialog('columns'),
            },
            ...(services.autofill
              ? [
                  {
                    label: 'Autofill profile…',
                    icon: <Wand2 className="size-4" />,
                    onSelect: () => setDialog('profile'),
                  },
                ]
              : []),
            'separator',
            {
              label: 'Export to CSV',
              icon: <FileSpreadsheet className="size-4" />,
              onSelect: () => void exportCsv(),
            },
            ...(recordsAllowed
              ? [
                  {
                    label: 'Export calendar (.ics)',
                    icon: <CalendarDays className="size-4" />,
                    onSelect: exportCalendar,
                  },
                ]
              : []),
            {
              label: 'Export backup',
              icon: <Download className="size-4" />,
              onSelect: () => void exportBackup(),
            },
            {
              label: 'Import backup…',
              icon: <Upload className="size-4" />,
              onSelect: () => setDialog('import'),
            },
            ...(plan !== 'free'
              ? [
                  'separator' as const,
                  {
                    label: 'Closing-date alerts',
                    icon: <BellRing className="size-4" />,
                    checked: settings.closingAlerts !== false,
                    onSelect: () => void toggleClosingAlerts(),
                  },
                ]
              : []),
            'separator',
            {
              label: 'Toolbar icon opens the side panel',
              icon: <PanelRight className="size-4" />,
              checked: settings.iconOpensPanel === true,
              onSelect: () => void toggleIconOpensPanel(),
            },
            'separator',
            { heading: 'Theme' },
            {
              label: 'System',
              icon: <Monitor className="size-4" />,
              checked: settings.theme === 'system',
              onSelect: () => setTheme('system'),
            },
            {
              label: 'Light',
              icon: <Sun className="size-4" />,
              checked: settings.theme === 'light',
              onSelect: () => setTheme('light'),
            },
            {
              label: 'Dark',
              icon: <Moon className="size-4" />,
              checked: settings.theme === 'dark',
              onSelect: () => setTheme('dark'),
            },
            'separator',
            {
              label: 'Keyboard shortcuts',
              icon: <Keyboard className="size-4" />,
              onSelect: () => void browser.tabs.create({ url: 'chrome://extensions/shortcuts' }),
            },
          ]}
        />
      </header>

      <PinTip />
      {accountState ? (
        <PlanBanner state={accountState} onOpenAccount={() => setDialog('account')} />
      ) : null}
      {board.hidden > 0 ? (
        <HistoryLimitNote
          className="mx-6 mt-0 mb-2"
          hidden={board.hidden}
          what={['finished job', 'finished jobs']}
          onSeePlans={account ? () => setDialog('account') : undefined}
        />
      ) : null}

      <main className="min-h-0 flex-1 pt-2">
        {!loaded ? (
          <div className="text-muted flex h-full items-center justify-center gap-2 text-sm">
            <Spinner /> Loading your board…
          </div>
        ) : jobs.length === 0 ? (
          <EmptyBoard onAdd={() => setDialog('add')} />
        ) : (
          <SelectionContext.Provider value={selection}>
            <Kanban
              settings={settings}
              allJobs={onBoard}
              visibleJobs={visibleJobs}
              filtered={deferredQuery.trim() !== ''}
              onOpen={openCard}
            />
          </SelectionContext.Provider>
        )}
      </main>

      {selectedIds.length ? (
        <BulkBar selected={selectedIds} stages={settings.stages} onDone={clearSelection} />
      ) : null}
      <JobDrawer
        job={openJob}
        stages={settings.stages}
        historyFrom={historyFrom}
        remindersAllowed={plan !== 'free'}
        recordsAllowed={recordsAllowed}
        onSeePlans={account ? () => setDialog('account') : undefined}
        onClose={() => openCard(undefined)}
      />
      <ColumnsDialog
        open={dialog === 'columns'}
        onClose={() => setDialog(null)}
        settings={settings}
        onSeePlans={account ? () => setDialog('account') : undefined}
      />
      <HistoryDialog
        open={dialog === 'history'}
        onClose={() => setDialog(null)}
        jobs={jobs}
        stages={settings.stages}
        historyFrom={historyFrom}
        onOpenJob={(id) => {
          setDialog(null);
          openCard(id);
        }}
        {...(account ? { onSeePlans: () => setDialog('account') } : {})}
      />
      <AddJobDialog
        open={dialog === 'add'}
        onClose={() => setDialog(null)}
        settings={settings}
        onSeePlans={account ? () => setDialog('account') : undefined}
      />
      <ImportDialog open={dialog === 'import'} onClose={() => setDialog(null)} />
      <UnsortedDialog open={dialog === 'unsorted'} onClose={() => setDialog(null)} />
      <InsightsDialog
        open={dialog === 'insights'}
        onClose={() => setDialog(null)}
        jobs={jobs}
        stages={settings.stages}
        allowed={allows(plan, 'insights')}
        onSeePlans={account ? () => setDialog('account') : undefined}
      />
      <ProfileDialog
        open={dialog === 'profile'}
        onClose={() => {
          setDialog(null);
          if (location.hash === '#profile') history.replaceState(null, '', location.pathname);
        }}
        onSeePlans={account ? () => setDialog('account') : undefined}
      />
      {account ? (
        <AccountDialog
          open={dialog === 'account'}
          onClose={() => {
            setDialog(null);
            if (location.hash === '#account') history.replaceState(null, '', location.pathname);
          }}
          account={account}
          state={accountState}
        />
      ) : null}
    </div>
  );
}
