import { Laptop, RefreshCw, Smartphone, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { SYNC_DEVICE_LIMITS, type Plan } from '@/domain/plan';
import type { RemoteDevice } from '@/services/backend/supabase-client';
import type { SyncProblem } from '@/services/sync-service';
import { Button, IconButton } from '@/ui/components/button';
import { useToast } from '@/ui/components/toast';
import { useServices } from '@/ui/hooks/services';
import { useSyncState } from '@/ui/hooks/sync';
import { relativeTime } from '@/ui/format';
import { backendErrorMessage } from './plan-copy';

const PROBLEM: Record<SyncProblem, string> = {
  not_allowed:
    'This browser is no longer syncing: it was removed on another device, or your plan changed. Turn sync on again to rejoin.',
  signed_out: 'Sign in again to keep syncing.',
  offline: 'Couldn’t reach Rolestash. Sync resumes when you’re back online.',
  error: 'The last sync didn’t finish. It will try again shortly.',
};

/** Sync across devices in the account dialog (ADR-0016). */
export function SyncSection({ plan }: { plan: Plan }) {
  const { sync } = useServices();
  const state = useSyncState();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [devices, setDevices] = useState<RemoteDevice[]>();
  const [full, setFull] = useState(false);

  const loadDevices = useCallback(async () => {
    if (sync) setDevices(await sync.devices());
  }, [sync]);

  useEffect(() => {
    if (!sync || !state?.enabled) return;
    let active = true;
    sync
      .devices()
      .then((d) => {
        if (active) setDevices(d);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [state?.enabled, sync]);

  if (!sync) return null;
  const limit = SYNC_DEVICE_LIMITS[plan];

  async function run(key: string, task: () => Promise<void>) {
    setBusy(key);
    try {
      await task();
    } catch (e) {
      toast({ message: backendErrorMessage(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  const turnOn = () =>
    run('on', async () => {
      const result = await sync.enable();
      if (result.ok) {
        setFull(false);
        await sync.sync();
        toast({ message: 'This browser is now syncing', tone: 'success' });
      } else if (result.reason === 'device_limit') {
        setFull(true);
        await loadDevices();
      } else {
        toast({ message: 'Sync is part of Pro.', tone: 'error' });
      }
    });

  const remove = (device: RemoteDevice) =>
    run(`rm-${device.id}`, async () => {
      await sync.removeDevice(device.id);
      await loadDevices();
      toast({ message: `${device.name} removed from sync`, tone: 'success' });
    });

  return (
    <section className="border-line rounded-xl border p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">Sync</span>
        {state?.enabled ? (
          <span className="text-muted text-xs">
            {state.lastSyncAt ? `Synced ${relativeTime(state.lastSyncAt)}` : 'Starting…'}
          </span>
        ) : null}
      </div>

      {plan === 'free' ? (
        <p className="text-muted mt-2 text-sm">
          Pro syncs your board across up to {SYNC_DEVICE_LIMITS.pro} devices, including your phone.
          Your board always stays on this device too.
        </p>
      ) : !state?.enabled ? (
        <>
          <p className="text-muted mt-2 text-sm">
            Keep this board in step on up to {limit} devices. Everything stays on this device too,
            and works offline.
          </p>
          {full ? (
            <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">
              You’re syncing the maximum {limit} devices. Remove one below to add this browser.
            </p>
          ) : null}
          <Button
            className="mt-3"
            variant="primary"
            loading={busy === 'on'}
            disabled={busy !== null}
            onClick={() => void turnOn()}
          >
            Sync this browser
          </Button>
        </>
      ) : (
        <>
          {state.problem ? (
            <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">
              {PROBLEM[state.problem]}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              icon={<RefreshCw className="size-4" />}
              loading={busy === 'now'}
              disabled={busy !== null}
              onClick={() =>
                void run('now', async () => {
                  await sync.sync();
                })
              }
            >
              Sync now
            </Button>
            {state.problem === 'not_allowed' ? (
              <Button
                size="sm"
                variant="primary"
                disabled={busy !== null}
                onClick={() => void turnOn()}
              >
                Turn sync on again
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => void run('off', () => sync.disable())}
            >
              Stop syncing this browser
            </Button>
          </div>
        </>
      )}

      {plan === 'pro' && !location.pathname.startsWith('/board') ? (
        <p className="text-muted mt-3 text-sm">
          On your phone, open{' '}
          <a
            className="text-accent font-medium"
            href="https://rolestash.com/board/"
            target="_blank"
            rel="noopener noreferrer"
          >
            rolestash.com/board
          </a>{' '}
          and sign in with this email. It counts as one of your devices.
        </p>
      ) : null}

      {devices && (state?.enabled || full) ? (
        <ul aria-label="Synced devices" className="divide-line mt-3 divide-y">
          {devices.map((d) => {
            const mine = d.id === state?.deviceId && state.enabled;
            return (
              <li key={d.id} className="flex items-center gap-2.5 py-2 text-sm">
                {d.kind === 'web' ? (
                  <Smartphone className="text-subtle size-4" />
                ) : (
                  <Laptop className="text-subtle size-4" />
                )}
                <span className="flex-1">
                  {d.name}
                  {mine ? <span className="text-subtle"> · this browser</span> : null}
                  <span className="text-subtle block text-xs">
                    Last seen {relativeTime(d.lastSeenAt)}
                  </span>
                </span>
                {mine ? null : (
                  <IconButton
                    label={`Remove ${d.name} from sync`}
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => void remove(d)}
                  >
                    <X className="size-4" />
                  </IconButton>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
