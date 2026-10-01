import { SupabaseClient } from '@/services/backend/supabase-client';
import { createServices, systemContext } from '@/services/container';
import type { ExtractorRunner, WebAuthFlow } from '@/services/ports';
import { mountApp } from '@/ui/app-root';
import { IndexedDbKeyValueStore } from './platform/idb-store';
import { webDeviceName } from './platform/device';
import { WebBoard } from './web-board';

/**
 * The web board (ADR-0017): rolestash.com/board/, for Advanced. The same
 * domain, storage and sync code as the extension, on IndexedDB, syncing as a
 * `web` device. Built by web/vite.config.ts; never part of the extension.
 */
const env = import.meta.env as Record<string, string | undefined>;
const config = { url: env.WXT_SUPABASE_URL ?? '', anonKey: env.WXT_SUPABASE_ANON_KEY ?? '' };

// The web board can't read tabs or run Google's extension sign-in flow.
const noRunner: ExtractorRunner = {
  run: () => Promise.reject(new Error('Not available on the web board')),
  snapshot: () => Promise.reject(new Error('Not available on the web board')),
};
const noAuthFlow: WebAuthFlow = {
  redirectUrl: () => `${location.origin}/board/`,
  launch: () => Promise.reject(new Error('Not available on the web board')),
};

const services = createServices(
  new IndexedDbKeyValueStore(),
  noRunner,
  systemContext,
  { client: new SupabaseClient(config, (input, init) => fetch(input, init)), authFlow: noAuthFlow },
  { name: webDeviceName(), kind: 'web' },
);

mountApp(services, <WebBoard />);
