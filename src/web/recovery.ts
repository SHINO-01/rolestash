/** What a password reset link brought (ADR-0036): its one-time session, or why it failed. */
export type Recovery = { token: string; email?: string } | { error: string };

/**
 * Reads a reset link's answer from the address (Supabase sends
 * /board/?reset=1#access_token=…&type=recovery, or #error_code=…) and removes
 * it at once, so the token isn't left in the address bar or history.
 */
export function takeRecovery(location: Location = window.location): Recovery | null {
  if (new URLSearchParams(location.search).get('reset') !== '1') return null;
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  history.replaceState(null, '', location.pathname);
  const token = hash.get('access_token');
  if (token && hash.get('type') === 'recovery') {
    const email = emailOf(token);
    return email ? { token, email } : { token };
  }
  return {
    error:
      hash.get('error_code') === 'otp_expired'
        ? 'This link has expired or was already used. Ask for a new one from “Forgot password?”.'
        : 'This link didn’t work. Ask for a new one from “Forgot password?”.',
  };
}

/** The email claim of a Supabase access token, to show whose password this is. */
function emailOf(token: string): string | undefined {
  try {
    const part = (token.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(part)) as { email?: unknown };
    return typeof claims.email === 'string' ? claims.email : undefined;
  } catch {
    return undefined;
  }
}
