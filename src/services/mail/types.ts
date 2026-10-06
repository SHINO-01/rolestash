import type { EmailInput, FirstLook } from '@/email/mailbox';

/** The mail services a mailbox can be connected from (ADR-0032). */
export const MAIL_PROVIDERS = ['gmail', 'outlook'] as const;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];

/** Signed-in access to one mailbox, as stored on this device. */
export interface MailTokens {
  accessToken: string;
  /** Epoch ms. */
  expiresAt: number;
  /** Outlook only: Gmail renews silently through Google's own session. */
  refreshToken?: string;
}

/** The mailbox's access was revoked or ran out: the user must connect again. */
export class MailAuthError extends Error {
  constructor(message = 'The mailbox needs to be connected again') {
    super(message);
    this.name = 'MailAuthError';
  }
}

/** The provider couldn't be reached, or answered oddly; try again later. */
export class MailUnavailableError extends Error {
  constructor(readonly status: number) {
    super(`Mail service error ${String(status)}`);
    this.name = 'MailUnavailableError';
  }
}

/** One provider's read-only view of a mailbox. */
export interface MailClient {
  /** The mailbox's own address. */
  address(token: string): Promise<string>;
  /**
   * Inbox messages received after `since`, oldest first, as ids and a first
   * look. `companies` (employers on the board) may narrow the provider's own
   * search; the caller still checks each first look.
   */
  list(
    token: string,
    since: Date,
    limit: number,
    companies: readonly string[],
  ): Promise<{ id: string; receivedAt: string; look: FirstLook }[]>;
  /** One message, in full, as the engine's input. */
  read(token: string, id: string): Promise<EmailInput | undefined>;
}

export async function getJson<T>(
  fetcher: typeof fetch,
  url: string,
  token: string,
  headers: Record<string, string> = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(url, { headers: { Authorization: `Bearer ${token}`, ...headers } });
  } catch {
    throw new MailUnavailableError(0);
  }
  if (response.status === 401 || response.status === 403) throw new MailAuthError();
  if (!response.ok) throw new MailUnavailableError(response.status);
  return (await response.json()) as T;
}

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** A random value for OAuth `state` or a PKCE verifier. */
export function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** The PKCE S256 challenge for a verifier. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return toBase64Url(new Uint8Array(digest));
}
