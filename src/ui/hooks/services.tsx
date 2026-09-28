import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { Job } from '@/domain/job';
import { DEFAULT_SETTINGS, type Settings } from '@/domain/settings';
import type { Services } from '@/services/container';

/**
 * React bindings for the service container. UI components read live data
 * through these hooks and never touch storage directly.
 */

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({
  services,
  children,
}: {
  services: Services;
  children: ReactNode;
}) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices must be used inside <ServicesProvider>');
  return services;
}

/**
 * A cached, subscribable view over a repository. Local writes are applied
 * optimistically (so drag-and-drop never flickers); storage events from other
 * extension contexts trigger a reload.
 */
export class LiveJobs {
  private state: { jobs: Job[]; loaded: boolean } = { jobs: [], loaded: false };
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(private readonly services: Services) {
    services.jobs.subscribe(() => void this.reload());
    void services.ready.then(() => this.reload());
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): { jobs: Job[]; loaded: boolean } => this.state;

  async reload(): Promise<void> {
    const version = ++this.version;
    const jobs = await this.services.jobs.list();
    if (version === this.version) this.set({ jobs, loaded: true });
  }

  applyLocal(changed: readonly Job[], removedIds: readonly string[] = []): void {
    const byId = new Map(this.state.jobs.map((j) => [j.id, j]));
    for (const id of removedIds) byId.delete(id);
    for (const job of changed) byId.set(job.id, job);
    this.set({ jobs: [...byId.values()], loaded: true });
  }

  private set(next: { jobs: Job[]; loaded: boolean }): void {
    this.state = next;
    for (const l of this.listeners) l();
  }
}

const liveJobsCache = new WeakMap<Services, LiveJobs>();

export function useLiveJobs(): LiveJobs {
  const services = useServices();
  let live = liveJobsCache.get(services);
  if (!live) {
    live = new LiveJobs(services);
    liveJobsCache.set(services, live);
  }
  return live;
}

export function useJobs(): { jobs: Job[]; loaded: boolean } {
  const live = useLiveJobs();
  return useSyncExternalStore(live.subscribe, live.getSnapshot);
}

export function useSettings(): Settings {
  const { settings } = useServices();
  const [value, setValue] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => {
    let active = true;
    const load = () =>
      void settings.get().then((s) => {
        if (active) setValue(s);
      });
    load();
    const unsubscribe = settings.subscribe(load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [settings]);
  return value;
}

/** Applies the theme setting to <html> and follows the OS when set to "system". */
export function useApplyTheme(): void {
  const { theme } = useSettings();
  const media = useMemo(() => window.matchMedia('(prefers-color-scheme: dark)'), []);
  const systemDark = useSyncExternalStore(
    (cb) => {
      media.addEventListener('change', cb);
      return () => media.removeEventListener('change', cb);
    },
    () => media.matches,
  );
  useEffect(() => {
    const dark = theme === 'dark' || (theme === 'system' && systemDark);
    document.documentElement.classList.toggle('dark', dark);
  }, [theme, systemDark]);
}
