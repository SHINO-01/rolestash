import type { AccountService } from '@/services/account-service';
import { decodeState, googleAuthUrl, sha256Hex } from '@/services/backend/google';
import { randomToken } from '@/services/backend/supabase-client';
import {
  ROLESTASH_EXTENSION_IDS,
  WEB_HANDOFF_MESSAGE,
  type WebHandoffReply,
} from '@/services/web-handoff';

/**
 * Sign-in helpers for the web board (ADR-0017): Google through
 * rolestash.com/auth/google/ (state "web"), and a hand-off from a signed-in
 * Rolestash extension in this browser.
 */

const GOOGLE_ATTEMPT = 'rolestash:google-attempt';
/** Set when someone signs out here, so the extension doesn't sign them straight back in. */
const NO_HANDOFF = 'rolestash:no-extension-sign-in';
const HANDOFF_TIMEOUT_MS = 8000;

const session = {
  get: (key: string) => {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key: string, value: string) => {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // private mode without storage: Google sign-in can't be checked, so it fails safely
    }
  },
  remove: (key: string) => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // nothing to remove
    }
  },
};

/** Sends this tab to Google; it comes back to /board/ through /auth/google/. */
export async function startGoogleSignIn(clientId: string): Promise<void> {
  const nonce = randomToken();
  const s = randomToken();
  session.set(GOOGLE_ATTEMPT, JSON.stringify({ nonce, s }));
  location.assign(
    googleAuthUrl({ clientId, nonceHash: await sha256Hex(nonce), state: { e: 'web', s } }),
  );
}

/**
 * Finishes a Google sign-in if this page load is Google's return. Returns
 * false when it isn't; throws when it is but doesn't check out.
 */
export async function completeGoogleSignIn(account: AccountService): Promise<boolean> {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const state = decodeState(fragment.get('state'));
  if (state?.e !== 'web') return false;
  // Never leave the token in the address bar or history.
  history.replaceState(null, '', location.pathname);
  const attempt = session.get(GOOGLE_ATTEMPT);
  session.remove(GOOGLE_ATTEMPT);
  const expected = attempt ? (JSON.parse(attempt) as { nonce: string; s: string }) : undefined;
  if (fragment.get('error')) throw new Error('Sign-in was cancelled');
  const idToken = fragment.get('id_token');
  if (expected?.s !== state.s || !idToken)
    throw new Error('That sign-in link has expired. Please try again.');
  await account.completeGoogleSignIn(idToken, expected.nonce);
  allowExtensionSignIn();
  return true;
}

interface RuntimeLike {
  sendMessage(id: string, message: unknown, callback: (reply: unknown) => void): void;
  lastError?: unknown;
}

/**
 * Asks a Rolestash extension in this browser for a sign-in. Chrome exposes
 * `chrome.runtime.sendMessage` to this page only because the extension lists
 * it in externally_connectable. Resolves undefined when there's no extension,
 * it's signed out, or the person signed out here earlier.
 */
export async function signInFromExtension(account: AccountService): Promise<boolean> {
  if (localStorageGet(NO_HANDOFF)) return false;
  const runtime = (globalThis as { chrome?: { runtime?: RuntimeLike } }).chrome?.runtime;
  if (!runtime?.sendMessage) return false;
  for (const id of ROLESTASH_EXTENSION_IDS) {
    const reply = await new Promise<WebHandoffReply | undefined>((resolve) => {
      const timer = setTimeout(() => resolve(undefined), HANDOFF_TIMEOUT_MS);
      try {
        runtime.sendMessage(id, { type: WEB_HANDOFF_MESSAGE }, (r) => {
          clearTimeout(timer);
          if (runtime.lastError) resolve(undefined); // no such extension installed
          resolve(r as WebHandoffReply | undefined);
        });
      } catch {
        clearTimeout(timer);
        resolve(undefined);
      }
    });
    if (reply?.tokenHash) {
      await account.signInWithHandoff(reply.tokenHash);
      return true;
    }
  }
  return false;
}

/** After signing out here: don't sign back in from the extension automatically. */
export function blockExtensionSignIn(): void {
  try {
    localStorage.setItem(NO_HANDOFF, '1');
  } catch {
    // storage blocked: nothing to remember
  }
}

/** After signing in here deliberately: the extension may sign this board in again. */
export function allowExtensionSignIn(): void {
  try {
    localStorage.removeItem(NO_HANDOFF);
  } catch {
    // storage blocked
  }
}

function localStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
