import { createServices, type Services } from '@/services/container';
import { SupabaseClient } from '@/services/backend/supabase-client';
import { backendConfig, ChromeWebAuthFlow } from './backend';
import { ChromeKeyValueStore } from './chrome-storage';
import { ScriptingAutofillRunner } from './autofill-runner';
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
      { name: deviceName(), kind: 'computer' },
      new ScriptingAutofillRunner(),
    );
  }
  return instance;
}

/** "Chrome on Windows": how this browser appears in the account's device list. */
function deviceName(): string {
  const ua = navigator.userAgent;
  const os = ua.includes('Windows')
    ? 'Windows'
    : ua.includes('CrOS')
      ? 'ChromeOS'
      : ua.includes('Mac OS X')
        ? 'macOS'
        : ua.includes('Linux')
          ? 'Linux'
          : 'this computer';
  const browser = ua.includes('Edg/')
    ? 'Edge'
    : ua.includes('OPR/')
      ? 'Opera'
      : ua.includes('Brave')
        ? 'Brave'
        : 'Chrome';
  return `${browser} on ${os}`;
}
