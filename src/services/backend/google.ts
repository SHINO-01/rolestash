import { BackendError } from './supabase-client';

/**
 * Google sign-in without Supabase's hosted redirect (ADR-0012), so Google's
 * account chooser says "continue to rolestash.com".
 *
 *   extension ──launchWebAuthFlow──▶ accounts.google.com (response_type=id_token)
 *             ◀── https://<id>.chromiumapp.org/#id_token=… ◀── rolestash.com/auth/google/
 *
 * The forwarding page only forwards to allow-listed extension IDs, and the
 * token travels in the URL fragment, which is never sent to any server.
 * The extension then exchanges the ID token with Supabase (grant_type=id_token),
 * which checks its signature, audience and nonce.
 */

export const GOOGLE_REDIRECT_URI = 'https://rolestash.com/auth/google/';
const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';

/** What travels through Google in `state`: the extension to return to, and a one-time value. */
export interface GoogleState {
  /** Extension ID (the <id> in https://<id>.chromiumapp.org/). */
  e: string;
  /** Random value this sign-in attempt expects back. */
  s: string;
}

const toBase64Url = (text: string) =>
  btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (text: string) => atob(text.replace(/-/g, '+').replace(/_/g, '/'));

export function encodeState(state: GoogleState): string {
  return toBase64Url(JSON.stringify(state));
}

export function decodeState(value: string | null): GoogleState | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(fromBase64Url(value)) as Partial<GoogleState>;
    return typeof parsed.e === 'string' && typeof parsed.s === 'string'
      ? { e: parsed.e, s: parsed.s }
      : undefined;
  } catch {
    return undefined;
  }
}

export function googleAuthUrl(input: {
  clientId: string;
  /** SHA-256 (hex) of the raw nonce later sent to Supabase. */
  nonceHash: string;
  state: GoogleState;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    response_type: 'id_token',
    redirect_uri: GOOGLE_REDIRECT_URI,
    scope: 'openid email profile',
    nonce: input.nonceHash,
    state: encodeState(input.state),
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTHORIZE}?${params.toString()}`;
}

/** Extracts the ID token from the final redirect, checking it belongs to this attempt. */
export function readGoogleResult(finalUrl: string, expected: GoogleState): string {
  const fragment = new URLSearchParams(new URL(finalUrl).hash.slice(1));
  const state = decodeState(fragment.get('state'));
  if (state?.s !== expected.s || state.e !== expected.e) {
    throw new BackendError('server');
  }
  if (fragment.get('error')) throw new Error('Sign-in was cancelled');
  const idToken = fragment.get('id_token');
  if (!idToken) throw new BackendError('server');
  return idToken;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
