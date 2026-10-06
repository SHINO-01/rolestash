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
  const googleClientId = import.meta.env.WXT_GOOGLE_CLIENT_ID;
  return url && anonKey
    ? { url: url.replace(/\/+$/, ''), anonKey, ...(googleClientId ? { googleClientId } : {}) }
    : undefined;
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

  async launchSilently(url: string): Promise<string | undefined> {
    try {
      return await browser.identity.launchWebAuthFlow({
        url,
        interactive: false,
        // Google answers prompt=none with a redirect after its page loads.
        abortOnLoadForNonInteractive: false,
        timeoutMsForNonInteractive: 10_000,
      });
    } catch {
      return undefined; // the provider wants the user
    }
  }
}

/** OAuth client IDs for connecting a mailbox (ADR-0032); each provider is off without its own. */
export function mailConfig(): { googleClientId?: string; microsoftClientId?: string } {
  // Its own switch, though usually the same client as sign-in: set once Google approves Gmail access.
  const google = import.meta.env.WXT_GMAIL_CLIENT_ID;
  const microsoft = import.meta.env.WXT_MICROSOFT_CLIENT_ID;
  return {
    ...(google ? { googleClientId: google } : {}),
    ...(microsoft ? { microsoftClientId: microsoft } : {}),
  };
}
