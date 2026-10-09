import { browser } from 'wxt/browser';
import type { MailConfig } from '@/services/mailbox-service';
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
 * board): a page that closes on blur would lose the sign-in window.
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
export function mailConfig(): MailConfig {
  // Its own switch, though usually the same client as sign-in. Whether release
  // builds offer Gmail before Google verifies the scope is gmailOffered's call.
  const google = import.meta.env.WXT_GMAIL_CLIENT_ID;
  const microsoft = import.meta.env.WXT_MICROSOFT_CLIENT_ID;
  return {
    mode: import.meta.env.MODE,
    ...(google ? { googleClientId: google } : {}),
    ...(microsoft ? { microsoftClientId: microsoft } : {}),
  };
}
