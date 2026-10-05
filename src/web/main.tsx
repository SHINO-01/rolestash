import { SupabaseClient } from '@/services/backend/supabase-client';
import { createServices, systemContext } from '@/services/container';
import type { ExtractorRunner, WebAuthFlow } from '@/services/ports';
import { mountApp } from '@/ui/app-root';
import { IndexedDbKeyValueStore } from './platform/idb-store';
import { webDeviceName } from './platform/device';
import { webConfig } from './config';
import { WebBoard } from './web-board';

/**
 * The web board (ADR-0017): rolestash.com/board/, for Pro. The same
 * domain, storage and sync code as the extension, on IndexedDB, syncing as a
 * `web` device. Built by web/vite.config.ts; never part of the extension.
 */

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
  {
    client: new SupabaseClient(webConfig, (input, init) => fetch(input, init)),
    authFlow: noAuthFlow,
  },
  { name: webDeviceName(), kind: 'web' },
  undefined,
  { version: 'web board', browser: webDeviceName() },
);

mountApp(services, <WebBoard />);
