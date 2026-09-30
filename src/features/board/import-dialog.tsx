import clsx from 'clsx';
import { FileUp } from 'lucide-react';
import { useState } from 'react';
import {
  BackupError,
  parseBackup,
  restoreBackup,
  type Backup,
  type ImportMode,
} from '@/storage/backup';
import { Button } from '@/ui/components/button';
import { Dialog } from '@/ui/components/overlay';
import { useToast } from '@/ui/components/toast';
import { useLiveJobs, useServices } from '@/ui/hooks/services';
import { formatDate } from '@/ui/format';

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const services = useServices();
  const live = useLiveJobs();
  const toast = useToast();
  const [backup, setBackup] = useState<Backup>();
  const [error, setError] = useState<{ message: string; details?: string[] }>();
  const [mode, setMode] = useState<ImportMode>('merge');
  const [busy, setBusy] = useState(false);

  function close() {
    setBackup(undefined);
    setError(undefined);
    setMode('merge');
    onClose();
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(undefined);
    try {
      setBackup(parseBackup(await file.text()));
    } catch (e) {
      setBackup(undefined);
      setError(
        e instanceof BackupError
          ? { message: e.message, ...(e.details ? { details: e.details } : {}) }
          : { message: 'Could not read that file.' },
      );
    }
  }

  async function confirm() {
    if (!backup) return;
    setBusy(true);
    try {
      const summary = await restoreBackup(backup, mode, services.jobs, services.settings);
      await live.reload();
      toast({
        tone: 'success',
        message:
          mode === 'replace'
            ? `Board replaced with ${summary.added} jobs`
            : `Imported ${summary.added} new, ${summary.updated} updated, ${summary.skipped} unchanged`,
      });
      close();
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : 'Import failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Import backup"
      description="Restore a Rolestash backup (.json) exported from this or another browser."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant={mode === 'replace' ? 'danger' : 'primary'}
            disabled={!backup}
            loading={busy}
            onClick={() => void confirm()}
          >
            {mode === 'replace' ? 'Replace my board' : 'Import'}
          </Button>
        </>
      }
    >
      <label className="hover:border-accent hover:bg-accent-soft/40 border-line-strong flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center transition-colors">
        <FileUp className="text-subtle size-6" />
        <span className="text-sm font-medium">
          {backup ? 'Choose a different file' : 'Choose a backup file'}
        </span>
        <input
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </label>

      {error ? (
        <div className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
          {error.message}
          {error.details?.length ? (
            <ul className="mt-1 list-disc pl-4 font-mono text-xs">
              {error.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {backup ? (
        <div className="mt-4 space-y-3">
          <p className="text-muted text-sm">
            <b className="text-ink">{backup.jobs.length} jobs</b> · exported{' '}
            {formatDate(backup.exportedAt)}
          </p>
          <div className="grid gap-2">
            {(
              [
                [
                  'merge',
                  'Merge',
                  'Add new jobs and update ones that changed. Nothing is deleted.',
                ],
                [
                  'replace',
                  'Replace',
                  'Delete everything on this board and load the backup instead.',
                ],
              ] as const
            ).map(([value, label, help]) => (
              <label
                key={value}
                className={clsx(
                  'flex cursor-pointer gap-3 rounded-xl border p-3',
                  mode === value
                    ? 'border-accent bg-accent-soft/50'
                    : 'border-line hover:border-line-strong',
                )}
              >
                <input
                  type="radio"
                  name="mode"
                  className="accent-accent mt-0.5"
                  checked={mode === value}
                  onChange={() => setMode(value)}
                />
                <span>
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="text-muted block text-xs">{help}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
