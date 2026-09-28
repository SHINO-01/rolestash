import {
  Download,
  Keyboard,
  Monitor,
  Moon,
  MoreHorizontal,
  Plus,
  Search,
  Sun,
  Upload,
} from 'lucide-react';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import type { Theme } from '@/domain/settings';
import { createBackup } from '@/storage/backup';
import { Button, IconButton, Spinner } from '@/ui/components/button';
import { Menu } from '@/ui/components/menu';
import { Kbd, Logo } from '@/ui/components/misc';
import { useToast } from '@/ui/components/toast';
import { useJobs, useServices, useSettings } from '@/ui/hooks/services';
import { matchesQuery } from '@/ui/format';
import { AddJobDialog } from './add-job-dialog';
import { EmptyBoard } from './empty-board';
import { ImportDialog } from './import-dialog';
import { JobDrawer } from './job-drawer';
import { Kanban } from './kanban';
import { BoardStats } from './board-stats';

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
  const [dialog, setDialog] = useState<'add' | 'import' | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const visibleJobs = useMemo(
    () => jobs.filter((j) => matchesQuery(j, deferredQuery)),
    [jobs, deferredQuery],
  );
  const openJob = openJobId ? jobs.find((j) => j.id === openJobId) : undefined;

  // Deep links (#job=<id>) from the popup and the "View on board" button.
  useEffect(() => {
    const onHash = () => setOpenJobId(readJobFromHash());
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

  async function exportBackup() {
    const backup = await createBackup(services.jobs, services.settings);
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `jobtrail-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast({ message: `Exported ${backup.jobs.length} jobs`, tone: 'success' });
  }

  const setTheme = (theme: Theme) => void services.settings.update({ theme });

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-16 shrink-0 items-center gap-4 px-6">
        <Logo />
        <div className="relative ml-4 w-full max-w-sm">
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
        <BoardStats jobs={jobs} stages={settings.stages} />
        <Button
          variant="primary"
          icon={<Plus className="size-4" />}
          onClick={() => setDialog('add')}
        >
          Add job
        </Button>
        <Menu
          trigger={(props) => (
            <IconButton label="Board menu" {...props}>
              <MoreHorizontal className="size-5" />
            </IconButton>
          )}
          items={[
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

      <main className="min-h-0 flex-1 pt-2">
        {!loaded ? (
          <div className="text-muted flex h-full items-center justify-center gap-2 text-sm">
            <Spinner /> Loading your board…
          </div>
        ) : jobs.length === 0 ? (
          <EmptyBoard onAdd={() => setDialog('add')} />
        ) : (
          <Kanban
            settings={settings}
            allJobs={jobs}
            visibleJobs={visibleJobs}
            filtered={deferredQuery.trim() !== ''}
            onOpen={openCard}
          />
        )}
      </main>

      <JobDrawer job={openJob} stages={settings.stages} onClose={() => openCard(undefined)} />
      <AddJobDialog open={dialog === 'add'} onClose={() => setDialog(null)} settings={settings} />
      <ImportDialog open={dialog === 'import'} onClose={() => setDialog(null)} />
    </div>
  );
}
