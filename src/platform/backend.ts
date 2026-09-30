import { browser } from 'wxt/browser';
import type { BackendConfig } from '@/services/backend/supabase-client';
import type { WebAuthFlow } from '@/services/ports';

/**
 * The backend this build talks to, or undefined when accounts are off
 * (ADR-0011: builds without WXT_SUPABASE_URL / WXT_SUPABASE_ANON_KEY behave
 * exactly like the local-only extension).
 */
export function backendConfig(): BackendConfig | undefined {
  const url = import.meta.env.WXT_SUPABASE_URL;
  const anonKey = import.meta.env.WXT_SUPABASE_ANON_KEY;
  return url && anonKey ? { url: url.replace(/\/+$/, ''), anonKey } : undefined;
}

/**
 * OAuth through chrome.identity. Must run from an extension *tab* (the
 * board): a popup closes when the sign-in window takes focus.
 */
export class ChromeWebAuthFlow implements WebAuthFlow {
  redirectUrl(): string {
    return browser.identity.getRedirectURL();
  }

  async launch(url: string): Promise<string> {
    const result = await browser.identity.launchWebAuthFlow({ url, interactive: true });
    if (!result) throw new Error('Sign-in was cancelled');
    return result;
  }
}
