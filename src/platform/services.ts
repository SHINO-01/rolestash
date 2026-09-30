import { createServices, type Services } from '@/services/container';
import { SupabaseClient } from '@/services/backend/supabase-client';
import { backendConfig, ChromeWebAuthFlow } from './backend';
import { ChromeKeyValueStore } from './chrome-storage';
import { ScriptingExtractorRunner } from './extractor-runner';

let instance: Services | undefined;

/** Lazily-built singleton wired to real browser APIs. */
export function getServices(): Services {
  if (!instance) {
    const config = backendConfig();
    instance = createServices(
      new ChromeKeyValueStore(),
      new ScriptingExtractorRunner(),
      undefined,
      config
        ? {
            client: new SupabaseClient(config, (input, init) => fetch(input, init)),
            authFlow: new ChromeWebAuthFlow(),
          }
        : undefined,
    );
  }
  return instance;
}
